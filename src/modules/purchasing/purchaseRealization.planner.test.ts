import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";
import {
  checkRealizationCharges,
  checkRealizationLines,
  realizationStatus,
  remainingToRealize,
  sumRealized,
  type PoLineRef,
  type RealizationLineInput,
} from "./purchaseRealization.planner";

const PLATE: PoLineRef = { poLineId: "p1", label: "Plate 2mm", qty: "6", unitPrice: "1250000" };

function line(overrides: Partial<RealizationLineInput> = {}): RealizationLineInput {
  return { poLineId: "p1", qty: "6", unitPrice: "1250000", note: "", ...overrides };
}

function check(lines: RealizationLineInput[], realized?: string) {
  return checkRealizationLines({
    lines,
    poLines: new Map([["p1", PLATE]]),
    realizedElsewhere: new Map(realized ? [["p1", new Decimal(realized)]] : []),
  });
}

describe("sumRealized / remaining / status", () => {
  it("sums per PO line and never goes below 0", () => {
    const sums = sumRealized([
      { poLineId: "p1", qty: "2" },
      { poLineId: "p1", qty: "1" },
    ]);
    assert.equal(sums.get("p1")?.toString(), "3");
    assert.equal(remainingToRealize("2", new Decimal(5)).toString(), "0");
  });

  it("tells none / partial / full", () => {
    assert.equal(realizationStatus([{ qty: "6", realized: undefined }]), "none");
    assert.equal(realizationStatus([{ qty: "6", realized: new Decimal(2) }]), "partial");
    assert.equal(
      realizationStatus([
        { qty: "6", realized: new Decimal(6) },
        { qty: "1", realized: new Decimal(1) },
      ]),
      "full",
    );
  });
});

describe("checkRealizationLines", () => {
  it("totals and compares with the approved price", () => {
    const out = check([line({ unitPrice: "1300000" })]);
    assert.equal(out.total, "7800000");
    assert.equal(out.difference, "300000");
    assert.equal(out.lines[0]!.difference, "300000");
  });

  it("shows a saving as a negative difference", () => {
    assert.equal(check([line({ unitPrice: "1200000" })]).difference, "-300000");
  });

  it("allows partial buys and blocks going past the PO qty", () => {
    assert.equal(check([line({ qty: "2" })], "4").total, "2500000");
    assert.throws(() => check([line({ qty: "3" })], "4"), /only 2 left/);
  });

  it("rejects empty, duplicate, unknown, zero qty and zero price lines", () => {
    assert.throws(() => check([]), /at least one/);
    assert.throws(() => check([line({ qty: "1" }), line({ qty: "1" })]), /twice/);
    assert.throws(() => check([line({ poLineId: "x" })]), /not on this PO/);
    assert.throws(() => check([line({ qty: "0" })]), /greater than 0/);
    assert.throws(() => check([line({ unitPrice: "0" })]), /actual price/);
  });
});

describe("checkRealizationCharges", () => {
  it("adds PPN as a percent of the subtotal and fixed charges as entered", () => {
    const out = checkRealizationCharges("7500000", [
      { label: " PPN 11% ", kind: "percent", rate: "11", amount: "0" },
      { label: "Ongkir", kind: "fixed", rate: null, amount: "150000" },
    ]);
    assert.deepEqual(out.charges, [
      { label: "PPN 11%", kind: "percent", rate: "11", amount: "825000" },
      { label: "Ongkir", kind: "fixed", rate: null, amount: "150000" },
    ]);
    assert.equal(out.chargesTotal, "975000");
    assert.equal(out.total, "8475000");
  });

  it("recomputes a percent amount from the subtotal, rounding half up", () => {
    const out = checkRealizationCharges("12345", [
      { label: "PPN", kind: "percent", rate: "11", amount: "999999" },
    ]);
    // 12345 × 11% = 1357.95
    assert.equal(out.charges[0]!.amount, "1358");
    assert.equal(out.total, "13703");
  });

  it("is a no-op without charges", () => {
    const out = checkRealizationCharges("5000", []);
    assert.equal(out.chargesTotal, "0");
    assert.equal(out.total, "5000");
  });

  it("rejects bad charges", () => {
    assert.throws(
      () => checkRealizationCharges("100", [{ label: " ", kind: "fixed", rate: null, amount: "5" }]),
      /needs a name/,
    );
    assert.throws(
      () => checkRealizationCharges("100", [{ label: "Ongkir", kind: "fixed", rate: null, amount: "0" }]),
      /above 0/,
    );
    assert.throws(
      () => checkRealizationCharges("100", [{ label: "PPN", kind: "percent", rate: "150", amount: "0" }]),
      /between 0 and 100/,
    );
  });
});
