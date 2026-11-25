import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { UomRepo } from "../../models/uom.model";
import { getUomsByIds, listActiveUoms } from "./uom.public";

/** Chainable query stub: builder methods return itself, `exec` resolves `value`. */
function query<T>(value: T, calls: Array<[string, unknown]> = []) {
  const q = {
    select: (arg: unknown) => (calls.push(["select", arg]), q),
    sort: (arg: unknown) => (calls.push(["sort", arg]), q),
    lean: () => q,
    exec: async () => value,
  };
  return q;
}

const U1 = "6ae9bd7a2e3bbc05e9139580";
const U2 = "6ae9bd7a2e3bbc05e9139581";

describe("listActiveUoms", () => {
  afterEach(() => mock.restoreAll());

  it("returns UoMs that are not deactivated, in store order", async () => {
    const filters: unknown[] = [];
    const calls: Array<[string, unknown]> = [];
    mock.method(UomRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([{ _id: new Types.ObjectId(U1), symbol: "m", name: "Meter" }], calls);
    });

    const uoms = await listActiveUoms();

    assert.deepEqual(filters[0], { isActive: { $ne: false } });
    assert.equal(calls.some(([k]) => k === "sort"), false);
    assert.deepEqual(uoms, [{ id: U1, symbol: "m", name: "Meter" }]);
  });

  it("sorts by symbol when asked", async () => {
    const calls: Array<[string, unknown]> = [];
    mock.method(UomRepo.model, "find", () => query([], calls));
    await listActiveUoms({ sorted: true });
    assert.deepEqual(calls.find(([k]) => k === "sort"), ["sort", { symbol: 1 }]);
  });
});

describe("getUomsByIds", () => {
  afterEach(() => mock.restoreAll());

  it("maps id to UoM (active or not), keeping raw formulas and decimals", async () => {
    const filters: unknown[] = [];
    mock.method(UomRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([
        { _id: new Types.ObjectId(U1), symbol: "m", name: "Meter", formulas: ["v1"], decimals: 2, isActive: false },
        { _id: new Types.ObjectId(U2), symbol: "pcs", name: "Piece" },
      ]);
    });

    const uoms = await getUomsByIds([U1, U2, U1, "not-an-id"]);

    assert.deepEqual(filters[0], { _id: { $in: [new Types.ObjectId(U1), new Types.ObjectId(U2)] } });
    assert.deepEqual([...uoms], [
      [U1, { id: U1, symbol: "m", name: "Meter", formulas: ["v1"], decimals: 2 }],
      [U2, { id: U2, symbol: "pcs", name: "Piece", formulas: undefined, decimals: undefined }],
    ]);
  });

  it("queries nothing for no ids", async () => {
    const find = mock.method(UomRepo.model, "find", () => query([]));
    assert.equal((await getUomsByIds([])).size, 0);
    assert.equal(find.mock.callCount(), 0);
  });
});
