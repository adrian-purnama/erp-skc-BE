import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  convertByFactors,
  convertItemQty,
  parsePositiveDecimal,
  rescaleFactorsForNewBase,
} from "./itemUomConvert";
import { parseCreateItemDto, parseUoms } from "../../validation/itemMaster";

describe("parsePositiveDecimal", () => {
  it("accepts valid positive decimals", () => {
    assert.equal(parsePositiveDecimal("12.5").toFixed(), "12.5");
    assert.equal(parsePositiveDecimal("1").toFixed(), "1");
  });

  it("rejects zero, negative, and bad shape", () => {
    assert.throws(() => parsePositiveDecimal("0"), /greater than 0/);
    assert.throws(() => parsePositiveDecimal("-1"), /greater than 0/);
    assert.throws(() => parsePositiveDecimal("abc"), /valid decimal/);
  });
});

describe("convertByFactors / convertItemQty", () => {
  const m = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const roll = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const pcs = "cccccccccccccccccccccccc";

  const rows = [
    { uomId: m, conversionFactor: "1" },
    { uomId: roll, conversionFactor: "50" },
    { uomId: pcs, conversionFactor: null },
  ];

  it("returns same qty for same UOM", () => {
    assert.equal(convertItemQty("3", m, m, rows), "3");
  });

  it("converts related UOMs through base", () => {
    // 2 roll = 100 m; 100 m = 2 roll
    assert.equal(convertItemQty("2", roll, m, rows), "100");
    assert.equal(convertItemQty("100", m, roll, rows), "2");
    assert.equal(convertByFactors("2", "50", "1"), "100");
  });

  it("rejects not-related UOMs", () => {
    assert.throws(
      () => convertItemQty("1", pcs, m, rows),
      /not convertible/,
    );
    assert.throws(
      () => convertItemQty("1", m, pcs, rows),
      /not convertible/,
    );
  });

  it("rejects unregistered UOMs", () => {
    assert.throws(
      () => convertItemQty("1", m, "dddddddddddddddddddddddd", rows),
      /not registered/,
    );
  });
});

describe("rescaleFactorsForNewBase", () => {
  it("leaves factors when base unchanged", () => {
    const out = rescaleFactorsForNewBase(
      [
        { uomId: "a", isBase: true, conversionFactor: "1" },
        { uomId: "b", isBase: false, conversionFactor: "12" },
      ],
      "a",
    );
    assert.equal(out.find((r) => r.uomId === "b")?.conversionFactor, "12");
  });

  it("rescales when base switches to a related UOM", () => {
    // was: 1 box = 12 can (base=can). Switch base to box → 1 can = 1/12 box
    const out = rescaleFactorsForNewBase(
      [
        { uomId: "can", isBase: false, conversionFactor: "1" },
        { uomId: "box", isBase: true, conversionFactor: "12" },
      ],
      "can",
    );
    assert.equal(out.find((r) => r.uomId === "box")?.conversionFactor, "1");
    assert.equal(out.find((r) => r.uomId === "can")?.conversionFactor, "0.08333333");
  });

  it("rejects switching base onto not-related UOM", () => {
    assert.throws(
      () =>
        rescaleFactorsForNewBase(
          [
            { uomId: "m", isBase: false, conversionFactor: "1" },
            { uomId: "pcs", isBase: true, conversionFactor: null },
          ],
          "m",
        ),
      /not-related/,
    );
  });
});

describe("parseUoms / create item dto", () => {
  const uomA = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const uomB = "bbbbbbbbbbbbbbbbbbbbbbbb";

  it("requires exactly one base and unique uoms", () => {
    const rows = parseUoms([
      { uomId: uomA, isBase: true, conversionFactor: "1" },
      { uomId: uomB, isBase: false, conversionFactor: "12" },
    ]);
    assert.equal(rows.length, 2);

    assert.throws(
      () =>
        parseUoms([
          { uomId: uomA, isBase: true, conversionFactor: "1" },
          { uomId: uomA, isBase: false, conversionFactor: "2" },
        ]),
      /Duplicate/,
    );
    assert.throws(
      () =>
        parseUoms([
          { uomId: uomA, isBase: false, conversionFactor: "1" },
        ]),
      /Exactly one base/,
    );
  });

  it("requires uoms on create", () => {
    assert.throws(
      () => parseCreateItemDto({ name: "Pipe", folderId: null }),
      /uoms is required/,
    );
    const dto = parseCreateItemDto({
      name: "Pipe",
      folderId: null,
      uoms: [{ uomId: uomA, isBase: true, conversionFactor: "1" }],
    });
    assert.equal(dto.uoms.length, 1);
  });
});
