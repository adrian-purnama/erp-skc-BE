import assert from "node:assert/strict";
import { describe, it, beforeEach, mock } from "node:test";
import { RoleModel } from "../../models/role.model";
import { getUserPermissions, invalidateAll } from "./resolve.service";

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
