import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evalUomFormula,
  normalizeFormulas,
  parseUomFormula,
} from "./uomFormula";

describe("parseUomFormula", () => {
  it("parses single and product formulas", () => {
    assert.deepEqual(parseUomFormula("v1"), {
      expression: "v1",
      variableCount: 1,
      variables: ["v1"],
    });
    assert.deepEqual(parseUomFormula("v1*v2"), {
      expression: "v1 * v2",
      variableCount: 2,
      variables: ["v1", "v2"],
    });
    assert.deepEqual(parseUomFormula("v1 * v2 * v3"), {
      expression: "v1 * v2 * v3",
      variableCount: 3,
      variables: ["v1", "v2", "v3"],
    });
  });

  it("rejects gaps and unknown tokens", () => {
    assert.throws(() => parseUomFormula("v2"), /contiguous/);
    assert.throws(() => parseUomFormula("v1 * v3"), /contiguous/);
    assert.throws(() => parseUomFormula("v1 + x"), /Invalid token/);
    assert.throws(() => parseUomFormula(""), /required/);
  });
});

describe("evalUomFormula", () => {
  it("evaluates products", () => {
    assert.equal(evalUomFormula("v1", { v1: 2 }), "2");
    assert.equal(evalUomFormula("v1 * v2", { v1: 2, v2: 3 }), "6");
    assert.equal(
      evalUomFormula("v1 * v2 * v3", { v1: 2, v2: 3, v3: 4 }),
      "24",
    );
  });
});

describe("normalizeFormulas", () => {
  it("trims, canonicalizes, and dedupes", () => {
    assert.deepEqual(normalizeFormulas([" v1 ", "v1*v2", "v1 * v2"]), [
      "v1",
      "v1 * v2",
    ]);
  });

  it("requires at least one", () => {
    assert.throws(() => normalizeFormulas([]), /At least one/);
  });
});
