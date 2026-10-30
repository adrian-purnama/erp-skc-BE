import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { resolveRabRounding } from "./projectRabUomPlan";

const itemId = new Types.ObjectId();

function row(
  isBase: boolean,
  conversionFactor: string | null,
  decimals: number | null = null,
  rounding: "up" | "nearest" | "down" = "up",
) {
  return {
    _id: new Types.ObjectId(),
    itemId,
    uomId: new Types.ObjectId(),
    isBase,
    conversionFactor,
    decimals,
    rounding,
  };
}

describe("resolveRabRounding", () => {
  it("uses the base row's own decimals over the unit's", () => {
    const base = row(true, "1", 0);
    assert.deepEqual(resolveRabRounding(base, [base], 2), {
      step: "1",
      source: "item",
      mode: "up",
    });
  });

  it("converts a related row's decimals into base units", () => {
    const base = row(true, "1");
    const sheet = row(false, "2.88", 0);
    assert.deepEqual(resolveRabRounding(base, [base, sheet], 2), {
      step: "2.88",
      source: "item",
      mode: "up",
    });
  });

  it("ignores decimals on unrelated rows for the base line", () => {
    const base = row(true, "1");
    const box = row(false, null, 2);
    assert.deepEqual(resolveRabRounding(base, [base, box], 0), {
      step: "1",
      source: "unit",
      mode: "up",
    });
  });

  it("uses an unrelated row's own decimals for its own line", () => {
    const base = row(true, "1", 0);
    const box = row(false, null, 1);
    assert.deepEqual(resolveRabRounding(box, [base, box], 0), {
      step: "0.1",
      source: "item",
      mode: "up",
    });
  });

  it("falls back to UOM decimals, then the default", () => {
    const base = row(true, "1");
    assert.deepEqual(resolveRabRounding(base, [base], 2), {
      step: "0.01",
      source: "unit",
      mode: "up",
    });
    assert.deepEqual(resolveRabRounding(base, [base], undefined), {
      step: "0.0001",
      source: "unit",
      mode: "up",
    });
  });

  it("takes the direction from the decimals row, else the target row", () => {
    const base = row(true, "1", null, "down");
    const sheet = row(false, "2.88", 0, "nearest");
    assert.equal(resolveRabRounding(base, [base, sheet], 2).mode, "nearest");
    assert.equal(resolveRabRounding(base, [base], 2).mode, "down");
  });
});
