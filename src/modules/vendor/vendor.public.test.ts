import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { VendorRepo } from "../../models/vendor.model";
import {
  assertVendorsActive,
  getVendorNames,
  getVendorRefs,
  listActiveVendors,
} from "./vendor.public";

function query<T>(value: T) {
  const q = { select: () => q, sort: () => q, lean: () => q, exec: async () => value };
  return q;
}

const A = "6ae9bd7a2e3bbc05e9139581";
const B = "6ae9bd7a2e3bbc05e9139582";
const docs = [
  { _id: new Types.ObjectId(A), name: "Alpha", address: "Jl. A" },
  { _id: new Types.ObjectId(B), name: "Beta", isActive: false },
];

describe("vendor public API", () => {
  afterEach(() => mock.restoreAll());

  it("maps vendors to DTOs; unset isActive counts as active", async () => {
    mock.method(VendorRepo.model, "find", () => query(docs));
    const refs = await getVendorRefs([A, new Types.ObjectId(B), null, "bad-id"]);
    assert.deepEqual(refs.get(A), { id: A, name: "Alpha", address: "Jl. A", npwp: "", isActive: true });
    assert.equal(refs.get(B)?.isActive, false);
  });

  it("returns names by id", async () => {
    mock.method(VendorRepo.model, "find", () => query(docs));
    assert.deepEqual([...(await getVendorNames([A, B]))], [[A, "Alpha"], [B, "Beta"]]);
  });

  it("does not query for no valid ids", async () => {
    const find = mock.method(VendorRepo.model, "find", () => query([]));
    assert.equal((await getVendorRefs([null, "x"])).size, 0);
    assert.equal(find.mock.callCount(), 0);
  });

  it("lists active vendors with the active filter, sorted by name", async () => {
    const calls: unknown[] = [];
    const q = query([docs[0]]);
    mock.method(VendorRepo.model, "find", (filter: unknown) => {
      calls.push(filter);
      return { ...q, sort: (s: unknown) => (calls.push(s), q) };
    });
    const out = await listActiveVendors();
    assert.deepEqual(calls, [{ isActive: { $ne: false } }]);
    assert.equal(out[0]?.name, "Alpha");
  });

  it("assertVendorsActive names every missing or disabled vendor", async () => {
    mock.method(VendorRepo.model, "find", () => query(docs));
    const missing = "6ae9bd7a2e3bbc05e9139589";
    await assert.rejects(
      assertVendorsActive([A, B, missing]),
      new Error(`Invalid or inactive vendors: Beta (disabled), ${missing} (not found)`),
    );
    await assert.doesNotReject(assertVendorsActive([A]));
  });
});
