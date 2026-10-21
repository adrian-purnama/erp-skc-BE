import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { Request, Response } from "express";
import { RoleModel } from "../../modules/admin/roles/role.model";
import { requirePermission } from "./requirePermission";
import { invalidateAll } from "./resolve.service";

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    body: unknown;
  };
}

describe("requirePermission", () => {
  it("returns 403 when the user has no matching permissions", async () => {
    invalidateAll();
    mock.method(RoleModel, "find", () => ({
      exec: async () => [{ effectivePermissions: [] }],
    }));

    const handler = requirePermission({ key: "admin.user.view" });
    assert.equal(handler.meta?.type, "permission");

    const req = {
      user: { id: "u1", roles: ["empty"] },
    } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    await handler(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, {
      success: false,
      message: "Forbidden",
      data: null,
    });
  });

  it("allows * to pass any permission key", async () => {
    invalidateAll();
    mock.method(RoleModel, "find", () => ({
      exec: async () => [{ effectivePermissions: ["*"] }],
    }));

    const handler = requirePermission({ key: "admin.brand.new" });
    const req = {
      user: { id: "u2", roles: ["super_admin"] },
    } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    await handler(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });
});
