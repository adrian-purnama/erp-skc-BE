import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { parseUpsertShopDrawingBoqDto } from "./projectShopDrawingBoq";
import { uomService } from "../modules/uom/uom.service";

const itemId = new Types.ObjectId().toString();
const itemId2 = new Types.ObjectId().toString();
const uomId = new Types.ObjectId().toString();
const uomId2 = new Types.ObjectId().toString();
const shopDrawingItemId = new Types.ObjectId().toString();
const shopDrawingFileId = new Types.ObjectId().toString();

function line(overrides: Record<string, unknown> = {}) {
  return {
    materialItemId: itemId,
    itemUomId: uomId,
    formula: "v1",
    inputs: { v1: "1" },
    ...overrides,
  };
}

function emptySections() {
  return {
    main: { parts: [], assembly: { lines: [] } },
    lighting: { lines: [] },
    mounting: { type: "mounted" as const, lines: [] },
    other: { lines: [] },
  };
}

describe("parseUpsertShopDrawingBoqDto sections", () => {
  it("parses formula + inputs in a flat section", () => {
    const dto = parseUpsertShopDrawingBoqDto({
      shopDrawingItemId,
      shopDrawingFileId,
      makeQty: "2",
      ...emptySections(),
      other: {
        lines: [
          {
            materialItemId: itemId,
            itemUomId: uomId,
            formula: "v1*v2",
            inputs: { v1: "2", v2: "3" },
            qtyPerUnit: "999",
          },
        ],
      },
    });
    assert.equal(dto.other.lines[0]?.formula, "v1 * v2");
    assert.deepEqual(dto.other.lines[0]?.inputs, { v1: "2", v2: "3" });
    const qty = uomService.calculateQty(
      dto.other.lines[0]!.formula,
      dto.other.lines[0]!.inputs,
    );
    assert.equal(qty, "6");
  });

  it("accepts empty draft sections", () => {
    const dto = parseUpsertShopDrawingBoqDto({
      shopDrawingItemId,
      shopDrawingFileId,
      makeQty: "1",
      ...emptySections(),
    });
    assert.equal(dto.main.parts.length, 0);
    assert.equal(dto.main.assembly.lines.length, 0);
    assert.equal(dto.lighting.lines.length, 0);
    assert.equal(dto.mounting.type, "mounted");
  });

  it("allows same material with different UOMs in one list", () => {
    const dto = parseUpsertShopDrawingBoqDto({
      shopDrawingItemId,
      shopDrawingFileId,
      makeQty: "1",
      ...emptySections(),
      lighting: {
        lines: [
          line(),
          line({ materialItemId: itemId, itemUomId: uomId2, inputs: { v1: "2" } }),
        ],
      },
    });
    assert.equal(dto.lighting.lines.length, 2);
  });

  it("rejects same material with the same UOM twice in one list", () => {
    assert.throws(
      () =>
        parseUpsertShopDrawingBoqDto({
          shopDrawingItemId,
          shopDrawingFileId,
          makeQty: "1",
          ...emptySections(),
          mounting: {
            type: "hanging",
            lines: [line(), line({ inputs: { v1: "2" } })],
          },
        }),
      /same UOM/,
    );
  });

  it("parses a base with top and bottom finishings (sandwich)", () => {
    const dto = parseUpsertShopDrawingBoqDto({
      shopDrawingItemId,
      shopDrawingFileId,
      makeQty: "1",
      ...emptySections(),
      main: {
        parts: [
          {
            key: "p1",
            label: "Face",
            bases: [
              {
                key: "b1",
                ...line({ spec: "3mm acrylic" }),
                finishings: [
                  {
                    finishingOrder: 1,
                    placement: "top",
                    lines: [
                      line({ materialItemId: itemId2, itemUomId: uomId }),
                    ],
                  },
                  {
                    finishingOrder: 1,
                    placement: "bottom",
                    lines: [
                      line({
                        materialItemId: itemId2,
                        itemUomId: uomId2,
                        inputs: { v1: "2" },
                      }),
                    ],
                  },
                ],
              },
            ],
          },
        ],
        assembly: { lines: [] },
      },
    });
    assert.equal(dto.main.parts[0]?.bases[0]?.spec, "3mm acrylic");
    assert.equal(dto.main.parts[0]?.bases[0]?.finishings[0]?.placement, "top");
    assert.equal(
      dto.main.parts[0]?.bases[0]?.finishings[1]?.placement,
      "bottom",
    );
  });

  it("rejects part without bases", () => {
    assert.throws(
      () =>
        parseUpsertShopDrawingBoqDto({
          shopDrawingItemId,
          shopDrawingFileId,
          makeQty: "1",
          ...emptySections(),
          main: {
            parts: [{ key: "p1", bases: [] }],
            assembly: { lines: [] },
          },
        }),
      /base material/,
    );
  });

  it("parses flat assembly material lines", () => {
    const dto = parseUpsertShopDrawingBoqDto({
      shopDrawingItemId,
      shopDrawingFileId,
      makeQty: "1",
      ...emptySections(),
      main: {
        parts: [
          {
            key: "p1",
            bases: [{ key: "b1", ...line(), finishings: [] }],
          },
        ],
        assembly: {
          lines: [
            line({ materialItemId: itemId2, itemUomId: uomId, inputs: { v1: "4" } }),
          ],
        },
      },
    });
    assert.equal(dto.main.assembly.lines.length, 1);
    assert.equal(dto.main.assembly.lines[0]?.inputs.v1, "4");
  });
});
