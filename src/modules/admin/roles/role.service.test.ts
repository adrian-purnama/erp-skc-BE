import assert from "node:assert/strict";
import { describe, it, mock, beforeEach } from "node:test";
import { RoleValidationError, roleService } from "./role.service";
import { RoleModel } from "./role.model";
import { UserModel } from "../../../models/user/user.model";
import { PermissionModel } from "../../../core/permissions/permission.model";

describe("role service guards", () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  it("rejects unknown and deprecated permissions on create", async () => {
    mock.method(RoleModel, "findOne", () => ({
      exec: async () => null,
    }));
    mock.method(PermissionModel, "find", () => ({
      select: () => ({
        exec: async () => [{ key: "admin.user.view" }],
      }),
      exec: async () => [{ key: "admin.user.view" }],
    }));
    mock.method(RoleModel, "find", () => ({
      exec: async () => [],
    }));

    await assert.rejects(
      () =>
        roleService.create(
          {
            key: "r1",
            name: "R1",
            permissions: ["not.real"],
            includes: [],
          },
          new Set(["*"]),
        ),
      RoleValidationError,
    );

    await assert.rejects(
      () =>
        roleService.create(
          {
            key: "r2",
            name: "R2",
            permissions: ["admin.user.view"],
            includes: [],
          },
          new Set(["*"]),
        ),
      (err: unknown) =>
        err instanceof RoleValidationError &&
        Boolean(err.fields?.permissions?.includes("deprecated")),
    );
  });

  it("rejects escalation when actor lacks a permission", async () => {
    mock.method(RoleModel, "findOne", () => ({
      exec: async () => null,
    }));
    mock.method(PermissionModel, "find", () => ({
      select: () => ({ exec: async () => [] }),
      exec: async () => [],
    }));
    mock.method(RoleModel, "find", () => ({
      exec: async () => [],
    }));

    await assert.rejects(
      () =>
        roleService.create(
          {
            key: "r3",
            name: "R3",
            permissions: ["admin.user.manage"],
            includes: [],
          },
          new Set(["admin.config.view"]),
        ),
      RoleValidationError,
    );
  });

  it("rejects blocking the last unblocked super_admin", async () => {
    mock.method(UserModel, "countDocuments", () => ({
      exec: async () => 1,
    }));
    mock.method(UserModel, "findById", () => ({
      exec: async () => ({
        id: "u1",
        roles: ["super_admin"],
        isBlocked: false,
        save: async () => undefined,
      }),
    }));

    // exercise via assignUserRoles removing super_admin
    mock.method(RoleModel, "find", () => ({
      exec: async () => [{ key: "user_admin", effectivePermissions: [] }],
    }));

    await assert.rejects(
      () =>
        roleService.assignUserRoles(
          "u1",
          ["user_admin"],
          "actor",
          new Set(["*"]),
        ),
      (err: unknown) =>
        err instanceof RoleValidationError &&
        err.message.includes("last super_admin"),
    );
  });

  it("rejects system role permission edits", async () => {
    mock.method(RoleModel, "findOne", () => ({
      exec: async () => ({
        key: "super_admin",
        name: "Super Admin",
        isSystem: true,
        permissions: ["*"],
        includes: [],
        description: "",
      }),
    }));

    await assert.rejects(
      () =>
        roleService.update(
          "super_admin",
          { permissions: ["admin.user.view"] },
          new Set(["*"]),
        ),
      RoleValidationError,
    );
  });
});
