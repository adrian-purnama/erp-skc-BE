import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { RoleModel } from "../../models/role.model";
import { UserModel } from "../../models/user.model";
import {
  getUserPermissions,
  invalidateAll,
  userHasPermission,
  usersWithPermission,
} from "./resolve.service";

const ONE_HOUR_MS = 60 * 60 * 1_000;

describe("resolve cache TTL", () => {
  beforeEach(() => {
    invalidateAll();
  });

  it("reloads an entry older than the TTL", async () => {
    const findCalls: unknown[] = [];
    const original = RoleModel.find;
    mock.method(RoleModel, "find", (...args: unknown[]) => {
      findCalls.push(args);
      return {
        exec: async () => [{ effectivePermissions: ["admin.user.view"] }],
      };
    });

    try {
      const user = { id: "u1", roles: ["user_admin"] };
      const first = await getUserPermissions(user, 1_000);
      assert.ok(first.has("admin.user.view"));
      assert.equal(findCalls.length, 1);

      const cached = await getUserPermissions(user, 1_000 + 1_000);
      assert.equal(findCalls.length, 1);
      assert.ok(cached.has("admin.user.view"));

      const expired = await getUserPermissions(user, 1_000 + ONE_HOUR_MS);
      assert.equal(findCalls.length, 2);
      assert.ok(expired.has("admin.user.view"));
    } finally {
      RoleModel.find = original;
    }
  });
});

/** Chainable query stub: every builder method returns itself, `exec` resolves `value`. */
function query<T>(value: T) {
  const q = {
    select: () => q,
    sort: () => q,
    lean: () => q,
    exec: async () => value,
  };
  return q;
}

describe("usersWithPermission", () => {
  afterEach(() => mock.restoreAll());

  it("returns plain DTOs for users holding a granting role", async () => {
    const userFilters: unknown[] = [];
    mock.method(RoleModel, "find", () => query([{ key: "finance" }]));
    mock.method(UserModel, "find", (filter: unknown) => {
      userFilters.push(filter);
      return query([
        { _id: new Types.ObjectId("6ae9bd7a2e3bbc05e9139576"), fullName: " Budi ", email: "b@x.test" },
        { _id: new Types.ObjectId("6ae9bd7a2e3bbc05e9139577"), email: "c@x.test" },
      ]);
    });

    const users = await usersWithPermission("purchasing.pay");

    assert.deepEqual(users, [
      { id: "6ae9bd7a2e3bbc05e9139576", fullName: "Budi", email: "b@x.test" },
      { id: "6ae9bd7a2e3bbc05e9139577", fullName: "", email: "c@x.test" },
    ]);
    assert.deepEqual(userFilters[0], {
      roles: { $in: ["finance"] },
      isBlocked: { $ne: true },
    });
  });

  it("skips the user query when no role grants the key", async () => {
    mock.method(RoleModel, "find", () => query([]));
    const userFind = mock.method(UserModel, "find", () => query([]));
    assert.deepEqual(await usersWithPermission("nobody.has.this"), []);
    assert.equal(userFind.mock.callCount(), 0);
  });
});

describe("userHasPermission", () => {
  beforeEach(() => invalidateAll());
  afterEach(() => mock.restoreAll());

  it("is false for a blocked user", async () => {
    mock.method(UserModel, "findById", () =>
      query({ _id: "u1", roles: ["finance"], isBlocked: true }),
    );
    assert.equal(await userHasPermission("u1", "purchasing.pay"), false);
  });

  it("is true when a role grants the key or *", async () => {
    mock.method(UserModel, "findById", () => query({ _id: "u2", roles: ["boss"] }));
    mock.method(RoleModel, "find", () => ({ exec: async () => [{ effectivePermissions: ["*"] }] }));
    assert.equal(await userHasPermission("u2", "purchasing.pay"), true);
  });
});
