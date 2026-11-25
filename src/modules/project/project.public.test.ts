import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { ProjectRepo } from "../../models/project.model";
import { ProjectRabRepo } from "../../models/projectRab.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem.model";
import {
  getProjectRab,
  getProjectRefs,
  getShopDrawingItemRefs,
  listLiveShopDrawingItems,
  markProjectReleasedToProduction,
  markProjectWon,
} from "./project.public";

function query<T>(value: T, calls: unknown[] = []) {
  const q = {
    select: () => q,
    sort: (s: unknown) => (calls.push({ sort: s }), q),
    lean: () => q,
    exec: async () => value,
  };
  return q;
}

const P = new Types.ObjectId("6ae9bd7a2e3bbc05e91395b1");
const C = new Types.ObjectId("6ae9bd7a2e3bbc05e91395b2");
const I = new Types.ObjectId("6ae9bd7a2e3bbc05e91395b3");
const U = "6ae9bd7a2e3bbc05e91395b4";

describe("project public API", () => {
  afterEach(() => mock.restoreAll());

  it("maps projects; releasedOnly adds the released filter", async () => {
    const filters: unknown[] = [];
    mock.method(ProjectRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([
        { _id: P, projectNumber: "PRJ/XI/2026/0001", name: "Tower", customerId: C, status: "win", productionReleasedAt: null },
      ]);
    });
    const refs = await getProjectRefs([P], { releasedOnly: true });
    assert.deepEqual(filters[0], { _id: { $in: [P] }, productionReleasedAt: { $ne: null } });
    assert.deepEqual(refs.get(String(P)), {
      id: String(P),
      projectNumber: "PRJ/XI/2026/0001",
      name: "Tower",
      customerId: String(C),
      customerContact: null,
      status: "win",
      productionReleasedAt: null,
      productionReleasedBy: null,
    });
  });

  it("maps shop drawing items with empty-string defaults", async () => {
    mock.method(ProjectShopDrawingItemRepo.model, "find", () =>
      query([{ _id: I, projectId: P, name: "Panel", isDeleted: false }]),
    );
    assert.deepEqual((await getShopDrawingItemRefs([I])).get(String(I)), {
      id: String(I),
      projectId: String(P),
      code: "",
      name: "Panel",
      dimension: "",
      category: null,
      makeType: null,
      makeQty: null,
      isDeleted: false,
    });
  });

  it("lists live items sorted by default, stored order when asked", async () => {
    const calls: unknown[] = [];
    mock.method(ProjectShopDrawingItemRepo.model, "find", (f: unknown) => {
      calls.push(f);
      return query([], calls);
    });
    await listLiveShopDrawingItems(String(P), { makeType: "outsource" });
    await listLiveShopDrawingItems(String(P), { sorted: false });
    assert.deepEqual(calls, [
      { projectId: P, isDeleted: false, makeType: "outsource" },
      { sort: { code: 1, name: 1 } },
      { projectId: P, isDeleted: false },
    ]);
  });

  it("returns no RAB for an invalid project id without querying", async () => {
    const findOne = mock.method(ProjectRabRepo.model, "findOne", () => query(null));
    assert.equal(await getProjectRab("nope"), null);
    assert.equal(findOne.mock.callCount(), 0);
  });

  it("markProjectWon / markProjectReleasedToProduction write the won state", async () => {
    const updates: unknown[] = [];
    mock.method(ProjectRepo, "findByIdAndUpdate", async (id: unknown, update: unknown) => {
      updates.push([id, update]);
      return null;
    });
    await markProjectWon(String(P));
    await markProjectReleasedToProduction(String(P), U);
    assert.deepEqual(updates[0], [String(P), { $set: { status: "win", loseReason: null, closeReason: null } }]);
    const [, released] = updates[1] as [string, { $set: Record<string, unknown> }];
    assert.equal(released.$set.status, "win");
    assert.ok(released.$set.productionReleasedAt instanceof Date);
    assert.deepEqual(released.$set.productionReleasedBy, new Types.ObjectId(U));
  });
});
