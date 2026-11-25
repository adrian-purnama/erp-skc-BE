import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateRealizationCost,
  buildProjectSummary,
  pickContractQuotation,
  nextMilestone,
  pickDeadline,
  projectDeadline,
  type SummaryInput,
  type SummaryQuotation,
} from "./projectSummary.planner";

const quotation = (
  status: string,
  revision: number,
  unitPrice: string,
): SummaryQuotation => {
  // As quotation prices it: 2 × unitPrice, no discount, PPN 11% on top.
  const taxBase = 2 * Number(unitPrice);
  return {
    status,
    revision,
    taxBase: String(taxBase),
    grandTotal: String(Math.round(taxBase * 1.11)),
  };
};

const base: SummaryInput = {
  quotations: [],
  rab: null,
  realizationTotals: [],
  shopDrawingCount: 0,
  orders: [],
  reportQtys: [],
  deadlines: [],
  status: "win",
  now: new Date("2026-10-30T00:00:00Z"),
};

describe("project summary", () => {
  it("prefers the won quotation over a later issued one", () => {
    const picked = pickContractQuotation([
      quotation("issued", 3, "1"),
      quotation("won", 1, "2"),
    ]);
    assert.equal(picked?.revision, 1);
  });

  it("falls back to the highest issued revision", () => {
    const picked = pickContractQuotation([
      quotation("issued", 1, "1"),
      quotation("issued", 2, "1"),
    ]);
    assert.equal(picked?.revision, 2);
  });

  it("picks the next upcoming deadline, else the latest past one", () => {
    const now = new Date("2026-10-30T00:00:00Z");
    const past = { at: new Date("2026-09-01T00:00:00Z"), title: "past" };
    const soon = { at: new Date("2026-11-01T00:00:00Z"), title: "soon" };
    const later = { at: new Date("2026-12-01T00:00:00Z"), title: "later" };
    assert.equal(pickDeadline([later, past, soon], now)?.title, "soon");
    assert.equal(pickDeadline([past], now)?.title, "past");
    assert.equal(pickDeadline([], now), null);
  });

  it("holds a tender to its calendar deadlines, a won project to its planned finish", () => {
    const now = new Date("2026-10-30T00:00:00Z");
    const pastTender = { at: new Date("2026-10-20T00:00:00Z"), title: "Deadline SPH" };
    const soon = { at: new Date("2026-11-05T00:00:00Z"), title: "Site visit" };
    const orders = [{ plannedFinish: "2026-12-01" }];
    // Tender: the last past milestone still counts (it is overdue).
    assert.equal(
      projectDeadline({ status: "open", deadlines: [pastTender], orders: [], now })?.title,
      "Deadline SPH",
    );
    // Won: past tender milestones stop counting; planned finish wins over SPK dates.
    assert.equal(
      projectDeadline({ status: "win", deadlines: [pastTender], orders, now, plannedFinishDate: "2026-12-06" })?.title,
      "Planned finish",
    );
    assert.equal(
      projectDeadline({ status: "win", deadlines: [pastTender], orders, now })?.title,
      "SPK planned finish",
    );
    assert.equal(projectDeadline({ status: "win", deadlines: [pastTender], orders: [], now }), null);
    assert.equal(nextMilestone([pastTender, soon], now)?.title, "Site visit");
    assert.equal(nextMilestone([pastTender], now), null);
  });

  it("rolls up money and production", () => {
    const summary = buildProjectSummary({
      ...base,
      quotations: [quotation("won", 1, "1000")],
      rab: {
        status: "locked",
        lines: [
          { totalQty: "3", unitPrice: "400" },
          { totalQty: "1", unitPrice: null },
        ],
      },
      realizationTotals: ["500", "250"],
      orders: [{ qty: "4", plannedFinish: "2026-12-01" }],
      reportQtys: ["1"],
    });
    assert.equal(summary.contractValue, "2220");
    assert.equal(summary.contractStatus, "won");
    assert.equal(summary.rabTotal, "1200");
    assert.equal(summary.plannedMargin, "800");
    assert.equal(summary.actualCost, "750");
    assert.equal(summary.productionPercent, 25);
    assert.equal(summary.deadlineTitle, "SPK planned finish");
  });

  it("counts non-tax RAB charges in the budget and margin", () => {
    const summary = buildProjectSummary({
      ...base,
      quotations: [quotation("won", 1, "1000")],
      rab: {
        status: "locked",
        lines: [{ totalQty: "3", unitPrice: "400" }],
        charges: [
          { category: "tax", label: "PPN", kind: "percent", rate: "11", amount: "132" },
          { category: "delivery", label: "Delivery", kind: "fixed", rate: null, amount: "100" },
          { category: "other", label: "Others", kind: "percent", rate: "10", amount: "0" },
        ],
      },
      productionPercent: 60,
    });
    assert.equal(summary.rabTotal, "1420");
    assert.equal(summary.plannedMargin, "580");
    assert.equal(summary.productionPercent, 60);
  });

  it("splits realization charges by line value per project", () => {
    const out = allocateRealizationCost({
      lines: [
        { projectId: "a", qty: "1", unitPrice: "300" },
        { projectId: "b", qty: "1", unitPrice: "100" },
        { projectId: null, qty: "1", unitPrice: "100" },
      ],
      subtotal: "500",
      total: "550",
    });
    assert.deepEqual(out, [
      { projectId: "a", amount: "330" },
      { projectId: "b", amount: "110" },
    ]);
  });

  it("leaves money null when nothing is quoted or priced", () => {
    const summary = buildProjectSummary(base);
    assert.equal(summary.contractValue, null);
    assert.equal(summary.rabTotal, null);
    assert.equal(summary.plannedMargin, null);
    assert.equal(summary.actualCost, "0");
    assert.equal(summary.deadline, null);
  });
});
