import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { numberingPeriod, toRomanMonth } from "./numbering";

/** Build a Date for a Jakarta wall-clock instant (UTC+7, no DST). */
function jakartaLocal(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  return new Date(
    Date.UTC(year, month - 1, day, hour - 7, minute, second, ms),
  );
}

describe("toRomanMonth", () => {
  it("maps 1..12 to I..XII", () => {
    assert.equal(toRomanMonth(1), "I");
    assert.equal(toRomanMonth(2), "II");
    assert.equal(toRomanMonth(11), "XI");
    assert.equal(toRomanMonth(12), "XII");
  });

  it("rejects months outside 1..12", () => {
    assert.throws(() => toRomanMonth(0));
    assert.throws(() => toRomanMonth(13));
  });
});

describe("numberingPeriod boundaries", () => {
  it("30 Nov 23:59:59.999 Jakarta → XI / 2026", () => {
    const parts = numberingPeriod(jakartaLocal(2026, 11, 30, 23, 59, 59, 999));
    assert.equal(parts.month, 11);
    assert.equal(parts.roman, "XI");
    assert.equal(parts.year, 2026);
    assert.equal(parts.scopeKey, "2026-11");
  });

  it("1 Dec 00:00:00.000 Jakarta → XII / 2026", () => {
    const parts = numberingPeriod(jakartaLocal(2026, 12, 1, 0, 0, 0, 0));
    assert.equal(parts.month, 12);
    assert.equal(parts.roman, "XII");
    assert.equal(parts.year, 2026);
    assert.equal(parts.scopeKey, "2026-12");
  });

  it("31 Dec 23:59:59.999 Jakarta → XII / 2026", () => {
    const parts = numberingPeriod(jakartaLocal(2026, 12, 31, 23, 59, 59, 999));
    assert.equal(parts.roman, "XII");
    assert.equal(parts.year, 2026);
  });

  it("1 Jan 00:00:00.000 Jakarta → I / 2027", () => {
    const parts = numberingPeriod(jakartaLocal(2027, 1, 1, 0, 0, 0, 0));
    assert.equal(parts.roman, "I");
    assert.equal(parts.year, 2027);
    assert.equal(parts.scopeKey, "2027-01");
  });

  it("29 Feb leap year Jakarta → II", () => {
    const parts = numberingPeriod(jakartaLocal(2024, 2, 29, 12, 0, 0, 0));
    assert.equal(parts.month, 2);
    assert.equal(parts.roman, "II");
    assert.equal(parts.year, 2024);
    assert.equal(parts.scopeKey, "2024-02");
  });

  it("UTC edge: 16:59:59.999Z stays previous Jakarta day", () => {
    // 2026-11-30T16:59:59.999Z = 2026-11-30 23:59:59.999 Jakarta
    const parts = numberingPeriod(new Date("2026-11-30T16:59:59.999Z"));
    assert.deepEqual([parts.year, parts.month, parts.roman], [2026, 11, "XI"]);
  });

  it("UTC edge: 17:00:00.000Z rolls to next Jakarta day", () => {
    // 2026-11-30T17:00:00.000Z = 2026-12-01 00:00:00.000 Jakarta
    const parts = numberingPeriod(new Date("2026-11-30T17:00:00.000Z"));
    assert.deepEqual([parts.year, parts.month, parts.roman], [2026, 12, "XII"]);
  });
});
