import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildShopDrawingSpecLines } from "./projectShopDrawingSpec";

const names = new Map([
  ["acr", "Acrylic 3mm"],
  ["ply", "Plywood 18mm"],
  ["duco", "Duco White"],
  ["sticker", "Sticker Oracal"],
  ["glue", "Lem Fox"],
  ["led", "LED Module"],
  ["bolt", "Dynabolt"],
]);

describe("buildShopDrawingSpecLines", () => {
  it("lists every section in order, each material once", () => {
    const lines = buildShopDrawingSpecLines(
      {
        main: {
          parts: [
            {
              bases: [
                {
                  materialItemId: "acr",
                  spec: "milky",
                  finishings: [
                    { lines: [{ materialItemId: "sticker" }] },
                    { lines: [{ materialItemId: "duco" }] },
                  ],
                },
                { materialItemId: "ply", finishings: [{ lines: [{ materialItemId: "duco" }] }] },
              ],
            },
          ],
          assembly: { lines: [{ materialItemId: "glue" }] },
        },
        lighting: { lines: [{ materialItemId: "led" }] },
        mounting: { type: "mounted", lines: [{ materialItemId: "bolt" }] },
      },
      names,
    );
    assert.deepEqual(lines, [
      "Finishing: Sticker Oracal, Duco White",
      "Material: Acrylic 3mm (milky), Plywood 18mm",
      "Assembly: Lem Fox",
      "Lighting: LED Module",
      "Mounting (Mounted): Dynabolt",
    ]);
  });

  it("leaves out empty sections and the 'other' mounting label", () => {
    const lines = buildShopDrawingSpecLines(
      {
        main: { parts: [{ bases: [{ materialItemId: "ply" }] }], assembly: { lines: [] } },
        lighting: { lines: [] },
        mounting: { type: "other", lines: [] },
      },
      names,
    );
    assert.deepEqual(lines, ["Material: Plywood 18mm"]);
  });

  it("keeps the mounting type when no mounting material is set", () => {
    const lines = buildShopDrawingSpecLines(
      { mounting: { type: "hanging", lines: [] } },
      names,
    );
    assert.deepEqual(lines, ["Mounting (Hanging)"]);
  });
});
