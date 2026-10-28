import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";
import {
  addFlow,
  checkRequestLines,
  materialKey,
  requestPlan,
  sumRequested,
  type MaterialFlowRow,
  type RequestLineInput,
  type SpkMaterialRow,
} from "./purchasing.planner";

const PLATE: SpkMaterialRow = { materialItemId: "m1", itemUomId: "u1", qty: "10" };
const BOLT: SpkMaterialRow = { materialItemId: "m2", itemUomId: "u2", qty: "4" };

function line(overrides: Partial<RequestLineInput> = {}): RequestLineInput {
  return { materialItemId: "m1", itemUomId: "u1", qty: "5", note: "", ...overrides };
}

function check(
  lines: RequestLineInput[],
  opts: { spk?: SpkMaterialRow[] | null; requested?: Map<string, Decimal>; rab?: string[] } = {},
) {
  return checkRequestLines({
    lines,
    spkMaterials: opts.spk === undefined ? [PLATE, BOLT] : opts.spk,
    requested: opts.requested ?? new Map(),
    rabKeys: new Set(opts.rab ?? [materialKey(PLATE)]),
    label: (key) => key,
  });
}

describe("sumRequested", () => {
  it("sums only SPK lines per material×UOM", () => {
    const sums = sumRequested([
      { source: "spk", materialItemId: "m1", itemUomId: "u1", qty: "2" },
      { source: "spk", materialItemId: "m1", itemUomId: "u1", qty: "1.5" },
      { source: "extra", materialItemId: "m1", itemUomId: "u1", qty: "9" },
    ]);
    assert.equal(sums.get(materialKey(PLATE))?.toString(), "3.5");
  });
});

describe("requestPlan", () => {
  it("shows requested and remaining, never below 0", () => {
    const rows = requestPlan(
      [PLATE, BOLT],
      new Map([
        [materialKey(PLATE), new Decimal(4)],
        [materialKey(BOLT), new Decimal(6)],
      ]),
    );
    assert.equal(rows[0]!.remainingQty, "6");
    assert.equal(rows[1]!.requestedQty, "6");
    assert.equal(rows[1]!.remainingQty, "0");
  });
});

describe("checkRequestLines", () => {
  it("treats SPK materials as SPK lines within plan and flags RAB membership", () => {
    const [out] = check([line()]);
    assert.equal(out!.source, "spk");
    assert.equal(out!.overPlan, false);
    assert.equal(out!.inRab, true);
  });

  it("requires at least one line", () => {
    assert.throws(() => check([]), /at least one/);
  });

  it("rejects the same material×UOM twice", () => {
    assert.throws(() => check([line(), line({ qty: "1" })]), /twice/);
  });

  it("rejects qty 0", () => {
    assert.throws(() => check([line({ qty: "0" })]), /greater than 0/);
  });

  it("needs a reason when the SPK total goes over plan", () => {
    const requested = new Map([[materialKey(PLATE), new Decimal(8)]]);
    assert.throws(() => check([line({ qty: "3" })], { requested }), /add a reason/);
    const [out] = check([line({ qty: "3", note: "scrap" })], { requested });
    assert.equal(out!.overPlan, true);
  });

  it("treats other materials as extra items that need a reason", () => {
    const other = line({ materialItemId: "m9", itemUomId: "u9" });
    assert.throws(() => check([other]), /outside the SPK/);
    const [out] = check([{ ...other, note: "  paint touch-up " }]);
    assert.equal(out!.source, "extra");
    assert.equal(out!.inRab, false);
    assert.equal(out!.note, "paint touch-up");
  });

  it("treats a known material in another unit as extra", () => {
    const [out] = check([line({ itemUomId: "u7", note: "buy by sheet" })]);
    assert.equal(out!.source, "extra");
  });

  it("treats every line as extra on a request without SPK", () => {
    assert.throws(() => check([line()], { spk: null }), /outside the SPK/);
    const [out] = check([line({ note: "stock" })], { spk: null });
    assert.equal(out!.source, "extra");
  });
});

describe("addFlow", () => {
  it("sums requested, ordered and received per material", () => {
    const rows = new Map<string, MaterialFlowRow>();
    addFlow(rows, "m1:u1", { requested: "10", ordered: new Decimal(6) });
    addFlow(rows, "m1:u1", { requested: "2", received: new Decimal(4) });
    const row = rows.get("m1:u1")!;
    assert.equal(row.requested.toString(), "12");
    assert.equal(row.ordered.toString(), "6");
    assert.equal(row.received.toString(), "4");
  });
});
