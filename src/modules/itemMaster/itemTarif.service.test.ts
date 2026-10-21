import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemTarifOutDto } from "../../dto/itemMaster.dto";
import {
  parseTarifs,
  parseYmdDate,
  pickTarifAsOf,
} from "../../validation/itemMaster";

function row(
  effectiveDate: string,
  amount: string,
  id = effectiveDate,
): ItemTarifOutDto {
  return {
    id,
    itemId: "item1",
    effectiveDate,
    amount,
  };
}

describe("pickTarifAsOf", () => {
  const rows = [
    row("2026-06-01", "120"),
    row("2025-01-01", "100"),
    row("2027-01-01", "150"),
  ];

  it("picks max effectiveDate <= asOf (current)", () => {
    const current = pickTarifAsOf(rows, "2026-10-18");
    assert.equal(current?.effectiveDate, "2026-06-01");
    assert.equal(current?.amount, "120");
  });

  it("returns earlier row when asOf is before a later change", () => {
    const past = pickTarifAsOf(rows, "2025-06-01");
    assert.equal(past?.effectiveDate, "2025-01-01");
    assert.equal(past?.amount, "100");
  });

  it("ignores future-dated rows", () => {
    const beforeFuture = pickTarifAsOf(rows, "2026-12-31");
    assert.equal(beforeFuture?.effectiveDate, "2026-06-01");
  });

  it("returns future row only when asOf reaches it", () => {
    const future = pickTarifAsOf(rows, "2027-01-01");
    assert.equal(future?.effectiveDate, "2027-01-01");
    assert.equal(future?.amount, "150");
  });

  it("returns null when no row is effective yet", () => {
    assert.equal(pickTarifAsOf(rows, "2024-12-31"), null);
    assert.equal(pickTarifAsOf([], "2026-01-01"), null);
  });
});

describe("tarif validation", () => {
  it("parses ymd and rejects invalid dates", () => {
    assert.equal(parseYmdDate("2026-01-15"), "2026-01-15");
    assert.throws(() => parseYmdDate("2026-13-01"), /valid calendar date/);
    assert.throws(() => parseYmdDate("01-15-2026"), /YYYY-MM-DD/);
  });

  it("rejects duplicate effective dates", () => {
    assert.throws(
      () =>
        parseTarifs([
          { effectiveDate: "2026-01-01", amount: "10" },
          { effectiveDate: "2026-01-01", amount: "20" },
        ]),
      /Duplicate effectiveDate/,
    );
  });

  it("allows zero amount and normalizes decimals", () => {
    const rows = parseTarifs([
      { effectiveDate: "2026-01-01", amount: "0" },
      { effectiveDate: "2026-02-01", amount: "12.50" },
    ]);
    assert.equal(rows[0]?.amount, "0");
    assert.equal(rows[1]?.amount, "12.5");
  });
});
