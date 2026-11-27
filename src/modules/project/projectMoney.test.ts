import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rabCostFactor, rabMoney } from "./projectRab.planner";
import { buildProjectSummary, rabBudget } from "./projectSummary.planner";
import { exportChargeRows, sumLineAmounts, type ExportLineIn } from "./projectRabExport.planner";
import { sumLineTotals } from "./projectRabChange.planner";
import type { ProjectRabLine } from "../../models/projectRab.model";

/**
 * "One gate out": every screen that shows RAB money must show the same rupiah
 * for the same RAB. PPN is part of the RAB grand total but not of the cost.
 */
describe("RAB money is the same everywhere", () => {
  const lines = [
    { totalQty: "3", unitPrice: "1000.333" },
    { totalQty: "7", unitPrice: "2500.5" },
    { totalQty: "12.5", unitPrice: "1234.567" },
  ];
  const charges = [
    { category: "tax" as const, label: "PPN", kind: "percent" as const, rate: "11", amount: "0" },
    { category: "delivery" as const, label: "Ongkir", kind: "fixed" as const, rate: null, amount: "150000" },
    { category: "other" as const, label: "Overhead", kind: "percent" as const, rate: "2.5", amount: "0" },
  ];
  const money = rabMoney(lines, charges);

  it("the RAB page and RAB change totals use whole rupiah", () => {
    assert.equal(money.subtotal, sumLineTotals(lines as unknown as ProjectRabLine[]));
    assert.match(money.grandTotal!, /^\d+$/);
    assert.match(money.cost!, /^\d+$/);
  });

  it("the dashboard budget is the RAB cost (no PPN)", () => {
    assert.equal(rabBudget({ status: "locked", lines, charges }), money.cost);
    const summary = buildProjectSummary({
      quotations: [{ status: "won", revision: 1, taxBase: "500000", grandTotal: "555000" }],
      rab: { status: "locked", lines, charges },
      realizationTotals: [],
      shopDrawingCount: 0,
      orders: [],
      reportQtys: [],
      deadlines: [],
      status: "win",
      now: new Date("2026-11-27T00:00:00Z"),
    });
    assert.equal(summary.rabTotal, money.cost);
  });

  it("the quotation spreads exactly the RAB cost", () => {
    const factor = rabCostFactor(money.subtotal, charges);
    const spread = (Number(money.subtotal) * Number(factor)).toFixed(0);
    assert.equal(spread, money.cost);
  });

  it("the xlsx export totals match the RAB page", () => {
    const exportLines = lines.map((l, i) => ({ ...l, key: `k${i}` })) as unknown as ExportLineIn[];
    const subtotal = sumLineAmounts(exportLines);
    assert.equal(String(subtotal), money.subtotal);
    const rows = exportChargeRows(subtotal, charges);
    const grand = subtotal + rows.reduce((s, c) => s + c.amount, 0);
    assert.equal(String(grand), money.grandTotal);
  });
});
