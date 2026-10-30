import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateBoqLinesToRab,
  computeLineTotal,
  mergeRabPricing,
  rabLineKey,
  rabQtyWaste,
  stepFromDecimals,
  sumGrandTotal,
  type RabUomPlan,
  unitPriceFromLineTotal,
  rabRowsForPurchasing,
  rabChargeFactor,
  rabTotalsWithCharges,
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
        rounding: { step: "1", source: "item", mode: "up" },
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
    assert.deepEqual(rows[0]!.rounding, { step: "1", source: "item", mode: "up" });
  });

  it("ignores 8-dp noise from yield division before rounding up", () => {
    // 2 sheets / 3 pcs = 0.66666667 → × 3 = 2.00000001, must stay 2.
    const rows = aggregateBoqLinesToRab(
      [{ materialItemId: "ply", itemUomId: "sheet", qtyPerUnit: "0.66666667", makeQty: "3" }],
      sheet,
    );
    assert.equal(rows[0]!.totalQty, "2");
  });

  it("rounds down or to nearest when the item asks for it", () => {
    // 1.25 plates, step 0.1: up 1.3, nearest 1.3, down 1.2. Step 1: up 2.
    const round = (step: string, mode: "up" | "nearest" | "down") =>
      aggregateBoqLinesToRab(
        [{ materialItemId: "plate", itemUomId: "pc", qtyPerUnit: "1.25", makeQty: "1" }],
        new Map([
          ["plate:pc", { targetItemUomId: "pc", factor: "1", rounding: { step, source: "unit", mode } }],
        ]),
      )[0]!.totalQty;
    assert.equal(round("0.1", "up"), "1.3");
    assert.equal(round("0.1", "nearest"), "1.3");
    assert.equal(round("0.1", "down"), "1.2");
    assert.equal(round("1", "up"), "2");
    assert.equal(round("1", "nearest"), "1");
    assert.equal(round("1", "down"), "1");
  });

  it("buys whole acrylic sheets for 50 pcs at 30 pcs per sheet", () => {
    const rows = aggregateBoqLinesToRab(
      [{ materialItemId: "acr", itemUomId: "sheet", qtyPerUnit: "0.03333333", makeQty: "50" }],
      new Map([
        ["acr:sheet", { targetItemUomId: "sheet", factor: "1", rounding: { step: "1", source: "item", mode: "up" } }],
      ]),
    );
    assert.equal(rows[0]!.totalQty, "2");
  });

  it("does not round up when the need is already whole", () => {
    const rows = aggregateBoqLinesToRab(
      [{ materialItemId: "paint", itemUomId: "l", qtyPerUnit: "2.5", makeQty: "4" }],
      new Map([
        ["paint:l", { targetItemUomId: "l", factor: "1", rounding: { step: "1", source: "item", mode: "up" } }],
      ]),
    );
    assert.equal(rows[0]!.totalQty, "10");
  });

  it("converts to the base UOM before summing", () => {
    // 1 sheet = 2.88 m²; base is m², 2 decimals fallback.
    const plan: RabUomPlan = new Map([
      ["ply:sheet", { targetItemUomId: "m2", factor: "2.88", rounding: { step: "0.01", source: "unit", mode: "up" } }],
      ["ply:m2", { targetItemUomId: "m2", factor: "1", rounding: { step: "0.01", source: "unit", mode: "up" } }],
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

  it("buys whole sheets when sheet has 0 decimals on an m² base", () => {
    // 0 decimals on sheet = 2.88 m² step: 3.213 m² → 2 sheets = 5.76 m².
    const plan: RabUomPlan = new Map([
      ["ply:m2", { targetItemUomId: "m2", factor: "1", rounding: { step: "2.88", source: "item", mode: "up" } }],
    ]);
    const rows = aggregateBoqLinesToRab(
      [{ materialItemId: "ply", itemUomId: "m2", qtyPerUnit: "3.213", makeQty: "1" }],
      plan,
    );
    assert.equal(rows[0]!.totalQty, "5.76");
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

describe("stepFromDecimals", () => {
  it("turns UOM decimals into a step", () => {
    assert.equal(stepFromDecimals(0), "1");
    assert.equal(stepFromDecimals(2), "0.01");
    assert.equal(stepFromDecimals(8), "0.00000001");
  });
});

describe("rabQtyWaste", () => {
  it("is purchase minus need, negative when rounded down", () => {
    assert.equal(rabQtyWaste("1.8", "2"), "0.2");
    assert.equal(rabQtyWaste("18.75", "18"), "-0.75");
    assert.equal(rabQtyWaste(undefined, "3"), null);
  });
});

describe("unitPriceFromLineTotal", () => {
  it("divides the line total by the purchase qty", () => {
    assert.equal(unitPriceFromLineTotal("21", "16380000"), "780000");
    const price = unitPriceFromLineTotal("21", "1000000");
    assert.equal(computeLineTotal("21", price)?.split(".")[0], "1000000");
  });

  it("rejects a zero qty", () => {
    assert.throws(() => unitPriceFromLineTotal("0", "100"));
  });
});

describe("mergeRabPricing price mode", () => {
  it("keeps a line typed by total in total mode", () => {
    const merged = mergeRabPricing(
      [
        {
          key: "m1:u1",
          materialItemId: "m1",
          itemUomId: "u1",
          totalQty: "21",
          exactQty: "20.4",
        },
      ],
      [{ key: "m1:u1", unitPrice: "1000", priceByTotal: true }],
    );
    assert.equal(merged[0]!.priceByTotal, true);
  });
});

describe("rabRowsForPurchasing", () => {
  it("merges a labour item costed to several drawings into one material×UOM row", () => {
    const rows = rabRowsForPurchasing([
      { materialItemId: "jasa", itemUomId: "pcs", totalQty: "10", unitPrice: "100" },
      { materialItemId: "jasa", itemUomId: "pcs", totalQty: "30", unitPrice: "200" },
      { materialItemId: "plate", itemUomId: "sht", totalQty: "5", unitPrice: null },
    ]);
    assert.deepEqual(rows, [
      { key: "jasa:pcs", materialItemId: "jasa", itemUomId: "pcs", qty: "40", unitPrice: "175" },
      { key: "plate:sht", materialItemId: "plate", itemUomId: "sht", qty: "5", unitPrice: null },
    ]);
  });
});

describe("RAB charges", () => {
  const charges = [
    { category: "tax" as const, label: "PPN", kind: "percent" as const, rate: "11", amount: "0" },
    { category: "delivery" as const, label: "Ongkir", kind: "fixed" as const, rate: null, amount: "100" },
  ];

  it("prices percent rows on the subtotal and adds them to the grand total", () => {
    const out = rabTotalsWithCharges("1000", charges);
    assert.equal(out.chargesTotal, "210");
    assert.equal(out.charges[0]!.amount, "110");
    assert.equal(out.grandTotal, "1210");
  });

  it("keeps grand total null while nothing is priced", () => {
    assert.equal(rabTotalsWithCharges(null, charges).grandTotal, null);
  });

  it("spreads charges as a cost factor", () => {
    assert.equal(rabChargeFactor("1000", charges), "1.21");
    assert.equal(rabChargeFactor("1000", []), "1");
    assert.equal(rabChargeFactor("0", charges), "1");
  });
});
