import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateProjectNumber,
  formatProjectNumber,
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
