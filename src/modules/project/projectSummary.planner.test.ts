import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateRealizationCost,
  buildProjectSummary,
  pickContractQuotation,
  pickDeadline,
  type SummaryInput,
  type SummaryQuotation,
} from "./projectSummary.planner";

const quotation = (
  status: string,
  revision: number,
  unitPrice: string,
): SummaryQuotation => ({
  status,
  revision,
  discountType: "amount",
  discountValue: "0",
  taxPercent: "11",
  lines: [{ qty: "2", unitPrice, costUnitPrice: "0" }],
});

const base: SummaryInput = {
  quotations: [],
  rab: null,
  realizationTotals: [],
  shopDrawingCount: 0,
  orders: [],
  reportQtys: [],
  deadlines: [],
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
