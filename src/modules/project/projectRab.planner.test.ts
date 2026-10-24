import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateBoqLinesToRab,
  computeLineTotal,
  mergeRabPricing,
  rabLineKey,
  sumGrandTotal,
} from "./projectRab.planner";

describe("aggregateBoqLinesToRab", () => {
  it("sums same material and UOM across sources", () => {
    const rows = aggregateBoqLinesToRab([
      {
        materialItemId: "m1",
        itemUomId: "u1",
        qtyPerUnit: "2",
        makeQty: "3",
      },
      {
        materialItemId: "m1",
        itemUomId: "u1",
        qtyPerUnit: "1",
        makeQty: "4",
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.key, rabLineKey("m1", "u1"));
    assert.equal(rows[0]!.totalQty, "10");
  });

  it("keeps different UOMs as separate rows", () => {
    const rows = aggregateBoqLinesToRab([
      {
        materialItemId: "m1",
        itemUomId: "u1",
        qtyPerUnit: "1",
        makeQty: "1",
      },
      {
        materialItemId: "m1",
        itemUomId: "u2",
        qtyPerUnit: "2",
        makeQty: "1",
      },
    ]);
    assert.equal(rows.length, 2);
    const keys = new Set(rows.map((r) => r.key));
    assert.ok(keys.has(rabLineKey("m1", "u1")));
    assert.ok(keys.has(rabLineKey("m1", "u2")));
  });
});

describe("mergeRabPricing", () => {
  it("preserves price for matching keys and drops obsolete", () => {
    const merged = mergeRabPricing(
      [
        {
          key: "m1:u1",
          materialItemId: "m1",
          itemUomId: "u1",
          totalQty: "5",
        },
        {
          key: "m2:u1",
          materialItemId: "m2",
          itemUomId: "u1",
          totalQty: "1",
        },
      ],
      [
        { key: "m1:u1", unitPrice: "100", tarifId: "t1" },
        { key: "m9:u1", unitPrice: "9" },
      ],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0]!.unitPrice, "100");
    assert.equal(merged[0]!.tarifId, "t1");
    assert.equal(merged[0]!.totalQty, "5");
    assert.equal(merged[1]!.unitPrice, undefined);
  });
});

describe("computeLineTotal / sumGrandTotal", () => {
  it("multiplies qty × price and sums", () => {
    assert.equal(computeLineTotal("2", "3"), "6");
    assert.equal(computeLineTotal("2", null), null);
    assert.equal(sumGrandTotal(["6", null, "4"]), "10");
    assert.equal(sumGrandTotal([null, null]), null);
  });
});
