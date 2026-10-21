import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateProjectNumber,
  formatProjectNumber,
  jakartaYmd,
  projectNumberParts,
  toRomanMonth,
  type SeqAllocator,
} from "./projectNumber";

/** In-memory allocator for unit tests (atomic per scopeKey). */
function createMemorySeqAllocator(): SeqAllocator {
  const counters = new Map<string, number>();
  let chain: Promise<unknown> = Promise.resolve();

  return {
    next(scopeKey: string): Promise<number> {
      const run = chain.then(() => {
        const next = (counters.get(scopeKey) ?? 0) + 1;
        counters.set(scopeKey, next);
        return next;
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

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
});

describe("jakartaYmd / projectNumberParts boundaries", () => {
  it("30 Nov 23:59:59.999 Jakarta → XI / 2026", () => {
    const now = jakartaLocal(2026, 11, 30, 23, 59, 59, 999);
    const parts = projectNumberParts(now);
    assert.equal(parts.month, 11);
    assert.equal(parts.roman, "XI");
    assert.equal(parts.year, 2026);
    assert.equal(parts.scopeKey, "2026-11");
  });

  it("1 Dec 00:00:00.000 Jakarta → XII / 2026", () => {
    const now = jakartaLocal(2026, 12, 1, 0, 0, 0, 0);
    const parts = projectNumberParts(now);
    assert.equal(parts.month, 12);
    assert.equal(parts.roman, "XII");
    assert.equal(parts.year, 2026);
    assert.equal(parts.scopeKey, "2026-12");
  });

  it("31 Dec 23:59:59.999 Jakarta → XII / 2026", () => {
    const now = jakartaLocal(2026, 12, 31, 23, 59, 59, 999);
    const parts = projectNumberParts(now);
    assert.equal(parts.roman, "XII");
    assert.equal(parts.year, 2026);
  });

  it("1 Jan 00:00:00.000 Jakarta → I / 2027", () => {
    const now = jakartaLocal(2027, 1, 1, 0, 0, 0, 0);
    const parts = projectNumberParts(now);
    assert.equal(parts.roman, "I");
    assert.equal(parts.year, 2027);
    assert.equal(parts.scopeKey, "2027-01");
  });

  it("29 Feb leap year Jakarta → II", () => {
    const now = jakartaLocal(2024, 2, 29, 12, 0, 0, 0);
    const parts = projectNumberParts(now);
    assert.equal(parts.month, 2);
    assert.equal(parts.roman, "II");
    assert.equal(parts.year, 2024);
    assert.equal(parts.scopeKey, "2024-02");
  });

  it("UTC edge: 16:59:59.999Z stays previous Jakarta day", () => {
    // 2026-11-30T16:59:59.999Z = 2026-11-30 23:59:59.999 Jakarta
    const now = new Date("2026-11-30T16:59:59.999Z");
    const ymd = jakartaYmd(now);
    assert.deepEqual(ymd, { year: 2026, month: 11 });
    assert.equal(projectNumberParts(now).roman, "XI");
  });

  it("UTC edge: 17:00:00.000Z rolls to next Jakarta day", () => {
    // 2026-11-30T17:00:00.000Z = 2026-12-01 00:00:00.000 Jakarta
    const now = new Date("2026-11-30T17:00:00.000Z");
    const ymd = jakartaYmd(now);
    assert.deepEqual(ymd, { year: 2026, month: 12 });
    assert.equal(projectNumberParts(now).roman, "XII");
  });
});

describe("formatProjectNumber", () => {
  it("pads sequence to 4 digits", () => {
    assert.equal(formatProjectNumber("XI", 2026, 1), "PRJ/XI/2026/0001");
    assert.equal(formatProjectNumber("XI", 2026, 2), "PRJ/XI/2026/0002");
    assert.equal(formatProjectNumber("XI", 2026, 3), "PRJ/XI/2026/0003");
    assert.equal(formatProjectNumber("I", 2027, 12), "PRJ/I/2027/0012");
  });
});

describe("allocateProjectNumber", () => {
  it("increments sequence for the same scope", async () => {
    const allocator = createMemorySeqAllocator();
    const now = jakartaLocal(2026, 11, 15);
    const a = await allocateProjectNumber({ now, allocator });
    const b = await allocateProjectNumber({ now, allocator });
    const c = await allocateProjectNumber({ now, allocator });
    assert.equal(a, "PRJ/XI/2026/0001");
    assert.equal(b, "PRJ/XI/2026/0002");
    assert.equal(c, "PRJ/XI/2026/0003");
  });

  it("resets sequence when month changes", async () => {
    const allocator = createMemorySeqAllocator();
    const nov = await allocateProjectNumber({
      now: jakartaLocal(2026, 11, 30, 23, 59, 59, 999),
      allocator,
    });
    const dec = await allocateProjectNumber({
      now: jakartaLocal(2026, 12, 1, 0, 0, 0, 0),
      allocator,
    });
    assert.equal(nov, "PRJ/XI/2026/0001");
    assert.equal(dec, "PRJ/XII/2026/0001");
  });

  it("50 parallel calls produce 50 unique numbers with no gaps", async () => {
    const allocator = createMemorySeqAllocator();
    const now = jakartaLocal(2026, 11, 10);
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        allocateProjectNumber({ now, allocator }),
      ),
    );
    const unique = new Set(results);
    assert.equal(unique.size, 50);
    const seqs = results
      .map((n) => Number(n.split("/").at(-1)))
      .sort((a, b) => a - b);
    assert.deepEqual(
      seqs,
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  });
});
