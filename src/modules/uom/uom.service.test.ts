import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import { parseCreateUomDto } from "../../validation/uom";
import { UomRepo } from "../../models/uom/uom.model";
import { uomService } from "./uom.service";

describe("uom validation", () => {
  it("requires symbol, category, name, and formulas", () => {
    assert.throws(() => parseCreateUomDto({}), /symbol is required/);
    assert.throws(
      () => parseCreateUomDto({ symbol: "cm", category: "length" }),
      /name is required/,
    );
    assert.throws(
      () =>
        parseCreateUomDto({
          symbol: "cm",
          category: "length",
          name: "Centimeter",
        }),
      /At least one formula/,
    );
    const dto = parseCreateUomDto({
      symbol: " cm ",
      category: " length ",
      name: " Centimeter ",
      formulas: ["v1"],
    });
    assert.deepEqual(dto, {
      symbol: "cm",
      category: "length",
      name: "Centimeter",
      formulas: ["v1"],
      decimals: 4,
      rounding: "up",
    });
  });

  it("normalizes multi-variable formulas", () => {
    const dto = parseCreateUomDto({
      symbol: "m2",
      category: "area",
      name: "Square meter",
      formulas: ["v1", "v1*v2"],
    });
    assert.deepEqual(dto.formulas, ["v1", "v1 * v2"]);
  });
});

describe("uomService.calculateQty", () => {
  it("evaluates snapshotted formula without DB", () => {
    assert.equal(uomService.calculateQty("v1", { v1: "2" }), "2");
    assert.equal(
      uomService.calculateQty("v1 * v2", { v1: "2", v2: "3" }),
      "6",
    );
    assert.equal(
      uomService.calculateQty("v1 * v2 * v3", {
        v1: "2",
        v2: "3",
        v3: "4",
      }),
      "24",
    );
  });

  it("rejects invalid tokens and missing inputs", () => {
    assert.throws(
      () => uomService.calculateQty("v1 + x", { v1: "1" }),
      /Invalid token/,
    );
    assert.throws(
      () => uomService.calculateQty("v1 * v2", { v1: "2" }),
      /v2 is required/,
    );
  });
});

describe("uomService.create", () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  it("rejects duplicate symbol case-insensitively", async () => {
    mock.method(UomRepo.model, "findOne", () => ({
      collation: () => ({
        lean: () => ({
          exec: async () => ({
            _id: "existing",
            symbol: "CM",
            category: "length",
            name: "Centimeter",
            formulas: ["v1"],
          }),
        }),
      }),
    }));

    await assert.rejects(
      () =>
        uomService.create({
          symbol: "cm",
          category: "length",
          name: "Centimeter",
          formulas: ["v1"],
          decimals: 4,
          rounding: "up",
        }),
      /already exists/,
    );
  });
});
