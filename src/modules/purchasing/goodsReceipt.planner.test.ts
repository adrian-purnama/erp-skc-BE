import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";
import {
  addFlow,
  checkReceiptLines,
  type MaterialFlowRow,
  type ReceiptLineInput,
} from "./goodsReceipt.planner";

const PO = new Map([
  ["p1", { poLineId: "p1", label: "Plate 2mm", qty: "6" }],
  ["p2", { poLineId: "p2", label: "Bolt M10", qty: "50" }],
]);

function check(lines: ReceiptLineInput[], before: Record<string, string> = {}) {
  return checkReceiptLines({
    lines,
    poLines: PO,
    receivedBefore: new Map(Object.entries(before).map(([k, v]) => [k, new Decimal(v)])),
  });
}

describe("checkReceiptLines", () => {
  it("keeps arrived lines and drops zero lines", () => {
    const out = check([
      { poLineId: "p1", qty: "4", note: " 1 dented " },
      { poLineId: "p2", qty: "0", note: "" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.note, "1 dented");
  });

  it("allows partial deliveries up to what is still expected", () => {
    assert.equal(check([{ poLineId: "p1", qty: "2", note: "" }], { p1: "4" }).length, 1);
    assert.throws(
      () => check([{ poLineId: "p1", qty: "3", note: "" }], { p1: "4" }),
      /only 2 still expected/,
    );
  });

  it("needs at least one arrived item", () => {
    assert.throws(() => check([{ poLineId: "p1", qty: "0", note: "" }]), /at least one/);
  });

  it("rejects unknown, duplicate and negative lines", () => {
    assert.throws(() => check([{ poLineId: "x", qty: "1", note: "" }]), /not on this PO/);
    assert.throws(
      () =>
        check([
          { poLineId: "p1", qty: "1", note: "" },
          { poLineId: "p1", qty: "1", note: "" },
        ]),
      /twice/,
    );
    assert.throws(() => check([{ poLineId: "p1", qty: "-1", note: "" }]), /negative/);
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
