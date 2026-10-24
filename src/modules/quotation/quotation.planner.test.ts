import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rabLineKey } from "../project/projectRab.planner";
import {
  boqLineKey,
  buildSeedLines,
  computeTotals,
  LABOUR_LINE_KEY,
  quotationNumber,
  repriceLines,
  sellPriceFromCost,
  type SeedBoq,
} from "./quotation.planner";

function boq(
  fileId: string,
  itemId: string,
  name: string,
  makeQty: string,
  lines: Array<[string, string, string]>,
  fileVersion = 1,
): SeedBoq {
  return {
    shopDrawingItemId: itemId,
    shopDrawingFileId: fileId,
    itemName: name,
    fileVersion,
    makeQty,
    other: {
      lines: lines.map(([m, u, q]) => ({
        materialItemId: m,
        itemUomId: u,
        qtyPerUnit: q,
      })),
    },
  };
}

describe("quotationNumber", () => {
  it("formats project number and revision", () => {
    assert.equal(quotationNumber("PRJ-001", 2), "QUO/PRJ-001/R2");
  });
});

describe("sellPriceFromCost", () => {
  it("applies markup and rounds to whole rupiah", () => {
    assert.equal(sellPriceFromCost("1000", "25"), "1250");
    assert.equal(sellPriceFromCost("333.5", "0"), "334");
  });
});

describe("buildSeedLines", () => {
  const rabLines = [
    { key: rabLineKey("m1", "u1"), totalQty: "10", unitPrice: "100" },
    { key: rabLineKey("m2", "u2"), totalQty: "4", unitPrice: "50" },
    { key: "l1:u", totalQty: "2", unitPrice: "300", origin: "labour" },
  ];

  it("prices one line per BOQ plus a labour lump sum", () => {
    const lines = buildSeedLines({
      boqs: [
        boq("f1", "i1", "Sign A", "2", [["m1", "u1", "3"], ["m2", "u2", "2"]]),
      ],
      rabLines,
      markupPercent: "10",
    });
    assert.equal(lines.length, 2);
    const item = lines[0]!;
    assert.equal(item.key, boqLineKey("f1"));
    assert.equal(item.qty, "2");
    assert.equal(item.costUnitPrice, "400");
    assert.equal(item.unitPrice, "440");
    const labour = lines[1]!;
    assert.equal(labour.key, LABOUR_LINE_KEY);
    assert.equal(labour.costUnitPrice, "600");
    assert.equal(labour.unitPrice, "660");
  });

  it("suffixes version when an item has several BOQs", () => {
    const lines = buildSeedLines({
      boqs: [
        boq("f2", "i1", "Sign A", "1", [["m1", "u1", "1"]], 2),
        boq("f1", "i1", "Sign A", "1", [["m1", "u1", "1"]], 1),
      ],
      rabLines: rabLines.slice(0, 1),
      markupPercent: "0",
    });
    assert.deepEqual(
      lines.map((l) => l.description),
      ["Sign A (v1)", "Sign A (v2)"],
    );
  });

  it("keeps edited description and overridden price from previous lines", () => {
    const first = buildSeedLines({
      boqs: [boq("f1", "i1", "Sign A", "1", [["m1", "u1", "1"]])],
      rabLines: rabLines.slice(0, 1),
      markupPercent: "0",
    });
    const edited = [
      { ...first[0]!, description: "Pylon sign", unitPrice: "999", priceOverridden: true },
    ];
    const next = buildSeedLines({
      boqs: [boq("f1", "i1", "Sign A", "1", [["m1", "u1", "2"]])],
      rabLines: rabLines.slice(0, 1),
      markupPercent: "0",
      previous: edited,
    });
    assert.equal(next[0]!.description, "Pylon sign");
    assert.equal(next[0]!.unitPrice, "999");
    assert.equal(next[0]!.costUnitPrice, "200");
  });

  it("throws when a BOQ material has no RAB price", () => {
    assert.throws(() =>
      buildSeedLines({
        boqs: [boq("f1", "i1", "Sign A", "1", [["mX", "uX", "1"]])],
        rabLines,
        markupPercent: "0",
      }),
    );
  });
});

describe("repriceLines", () => {
  it("leaves overridden prices alone", () => {
    const out = repriceLines(
      [
        { key: "a", kind: "item", description: "", qty: "1", uom: "unit", costUnitPrice: "100", unitPrice: "100", priceOverridden: false },
        { key: "b", kind: "item", description: "", qty: "1", uom: "unit", costUnitPrice: "100", unitPrice: "500", priceOverridden: true },
      ],
      "20",
    );
    assert.equal(out[0]!.unitPrice, "120");
    assert.equal(out[1]!.unitPrice, "500");
  });
});

describe("computeTotals", () => {
  const lines = [
    { qty: "2", unitPrice: "1000", costUnitPrice: "700" },
    { qty: "1", unitPrice: "500", costUnitPrice: "400" },
  ];

  it("applies percent discount then tax", () => {
    const t = computeTotals({
      lines,
      discountType: "percent",
      discountValue: "10",
      taxPercent: "11",
    });
    assert.equal(t.subtotal, "2500");
    assert.equal(t.discountAmount, "250");
    assert.equal(t.taxBase, "2250");
    assert.equal(t.taxAmount, "248");
    assert.equal(t.grandTotal, "2498");
    assert.equal(t.costTotal, "1800");
    assert.equal(t.margin, "450");
  });

  it("caps amount discount at subtotal", () => {
    const t = computeTotals({
      lines,
      discountType: "amount",
      discountValue: "99999",
      taxPercent: "0",
    });
    assert.equal(t.discountAmount, "2500");
    assert.equal(t.grandTotal, "0");
  });
});
