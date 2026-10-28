import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";
import {
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
