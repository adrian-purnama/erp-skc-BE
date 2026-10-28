import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateBoqLinesToRab,
  computeLineTotal,
  mergeRabPricing,
  rabLineKey,
  rabQtyWaste,
  sumGrandTotal,
  type RabUomPlan,
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
          exactQty: "5",
        },
        {
          key: "m2:u1",
          materialItemId: "m2",
          itemUomId: "u1",
          totalQty: "1",
          exactQty: "1",
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

describe("aggregateBoqLinesToRab with UOM plan", () => {
  const sheet: RabUomPlan = new Map([
    [
      "ply:sheet",
      {
        targetItemUomId: "sheet",
        factor: "1",
        rounding: { decimals: 0, mode: "up" },
      },
    ],
  ]);

  it("rounds the project total once, sharing leftovers across drawings", () => {
    // SD-A: 75 pcs at 1 sheet / 50 pcs = 1.5; SD-B: 0.3 → 1.8 → 2 sheets.
    const rows = aggregateBoqLinesToRab(
      [
        { materialItemId: "ply", itemUomId: "sheet", qtyPerUnit: "0.02", makeQty: "75" },
        { materialItemId: "ply", itemUomId: "sheet", qtyPerUnit: "0.3", makeQty: "1" },
      ],
      sheet,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.exactQty, "1.8");
    assert.equal(rows[0]!.totalQty, "2");
    assert.deepEqual(rows[0]!.rounding, { decimals: 0, mode: "up" });
  });

  it("ignores 8-dp noise from yield division before rounding up", () => {
    // 2 sheets / 3 pcs = 0.66666667 → × 3 = 2.00000001, must stay 2.
    const rows = aggregateBoqLinesToRab(
      [{ materialItemId: "ply", itemUomId: "sheet", qtyPerUnit: "0.66666667", makeQty: "3" }],
      sheet,
    );
    assert.equal(rows[0]!.totalQty, "2");
  });

  it("supports nearest and down modes", () => {
    const row = (mode: "nearest" | "down") =>
      aggregateBoqLinesToRab(
        [{ materialItemId: "p", itemUomId: "l", qtyPerUnit: "0.25", makeQty: "75" }],
        new Map([
          ["p:l", { targetItemUomId: "l", factor: "1", rounding: { decimals: 0, mode } }],
        ]),
      )[0]!;
    assert.equal(row("nearest").totalQty, "19");
    assert.equal(row("down").totalQty, "18");
  });

  it("converts to the base UOM before summing", () => {
    // 1 sheet = 2.88 m²; base is m², 2 decimals.
    const plan: RabUomPlan = new Map([
      ["ply:sheet", { targetItemUomId: "m2", factor: "2.88", rounding: { decimals: 2, mode: "up" } }],
      ["ply:m2", { targetItemUomId: "m2", factor: "1", rounding: { decimals: 2, mode: "up" } }],
    ]);
    const rows = aggregateBoqLinesToRab(
      [
        { materialItemId: "ply", itemUomId: "sheet", qtyPerUnit: "1", makeQty: "1" },
        { materialItemId: "ply", itemUomId: "m2", qtyPerUnit: "0.333", makeQty: "1" },
      ],
      plan,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.key, rabLineKey("ply", "m2"));
    assert.equal(rows[0]!.exactQty, "3.213");
    assert.equal(rows[0]!.totalQty, "3.22");
  });

  it("leaves qty unrounded without a plan", () => {
    const rows = aggregateBoqLinesToRab([
      { materialItemId: "m", itemUomId: "u", qtyPerUnit: "0.02", makeQty: "75" },
    ]);
    assert.equal(rows[0]!.totalQty, "1.5");
    assert.equal(rows[0]!.exactQty, "1.5");
    assert.equal(rows[0]!.rounding, undefined);
  });
});

describe("rabQtyWaste", () => {
  it("is purchase minus need, negative when rounded down", () => {
    assert.equal(rabQtyWaste("1.8", "2"), "0.2");
    assert.equal(rabQtyWaste("18.75", "18"), "-0.75");
    assert.equal(rabQtyWaste(undefined, "3"), null);
  });
});
