import { UserModel } from "../../../models/user/user.model";
import { get, has, implied } from "../../../core/permissions/registry";
import { PermissionModel } from "../../../core/permissions/permission.model";
import {
  invalidateAll,
  invalidateUser,
} from "../../../core/permissions/resolve.service";
import type {
  CreateRoleInput,
  UpdateRoleInput,
} from "../../../dto/role.dto";
import {
  isRoleSlug,
  RoleValidationError,
} from "../../../validation/role";
import { RoleModel, type RoleInterface } from "./role.model";

export { RoleValidationError };

export class RoleConflictError extends Error {
  constructor(
    message: string,
    readonly assignedUserCount: number,
  ) {
    super(message);
  }
}

export type RoleOut = {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  includes: string[];
  effectivePermissions: string[];
  isSystem: boolean;
  assignedUserCount: number;
  activeSuperAdminCount: number;
};

async function countActiveSuperAdmins(): Promise<number> {
  return UserModel.countDocuments({
    roles: "super_admin",
    isBlocked: false,
  }).exec();
}

async function assignedCount(roleKey: string): Promise<number> {
  return UserModel.countDocuments({ roles: roleKey }).exec();
}

function toOut(
  role: RoleInterface,
  assignedUserCount: number,
  activeSuperAdminCount: number,
): RoleOut {
  return {
    key: role.key,
    name: role.name,
    description: role.description ?? "",
    permissions: role.permissions,
    includes: role.includes,
    effectivePermissions: role.effectivePermissions,
    isSystem: role.isSystem,
    assignedUserCount,
    activeSuperAdminCount,
  };
}

async function deprecatedKeys(): Promise<Set<string>> {
  const docs = await PermissionModel.find({ status: "deprecated" })
    .select("key")
    .exec();
  return new Set(docs.map((d) => d.key));
}

export function computeEffective(
  permissions: string[],
  includes: string[],
  includePermissions: Map<string, string[]>,
  deprecated: Set<string>,
): string[] {
  if (permissions.includes("*")) return ["*"];

  const result = new Set<string>();
  const add = (key: string) => {
    if (key === "*" || deprecated.has(key)) return;
    if (!has(key)) return;
    result.add(key);
    for (const child of implied(key)) {
      if (!deprecated.has(child) && has(child)) result.add(child);
    }
  };

  for (const key of permissions) add(key);
  for (const includeKey of includes) {
    for (const key of includePermissions.get(includeKey) ?? []) add(key);
  }
  return [...result].sort();
}

export class RoleService {
  async list(): Promise<RoleOut[]> {
    const roles = await RoleModel.find().sort({ key: 1 }).exec();
    const activeSuperAdminCount = await countActiveSuperAdmins();
    const out: RoleOut[] = [];
    for (const role of roles) {
      out.push(
        toOut(role, await assignedCount(role.key), activeSuperAdminCount),
      );
    }
    return out;
  }

  async get(key: string): Promise<RoleOut> {
    const role = await RoleModel.findOne({ key }).exec();
    if (!role) throw new Error("Role not found");
    return toOut(
      role,
      await assignedCount(role.key),
      await countActiveSuperAdmins(),
    );
  }

  async create(
    input: CreateRoleInput,
    actorPermissions: Set<string>,
  ): Promise<RoleOut> {
    if (!isRoleSlug(input.key)) {
      throw new RoleValidationError("key must be a slug", {
        key: "key must be a slug",
      });
    }
    const existing = await RoleModel.findOne({ key: input.key }).exec();
    if (existing) {
      throw new RoleValidationError("key already exists", {
        key: "key already exists",
      });
    }

    await this.validatePermissionsAndIncludes(
      input.key,
      input.permissions,
      input.includes,
      actorPermissions,
    );

    const deprecated = await deprecatedKeys();
    const includePermissions = await this.loadIncludePermissions(
      input.includes,
    );
    const effectivePermissions = computeEffective(
      input.permissions,
      input.includes,
      includePermissions,
      deprecated,
    );

    const role = await RoleModel.create({
      key: input.key,
      name: input.name,
      description: input.description ?? "",
      permissions: input.permissions,
      includes: input.includes,
      effectivePermissions,
      isSystem: false,
    });

    invalidateAll();
    return toOut(role, 0, await countActiveSuperAdmins());
  }

  async update(
    key: string,
    patch: UpdateRoleInput,
    actorPermissions: Set<string>,
  ): Promise<RoleOut> {
    const role = await RoleModel.findOne({ key }).exec();
    if (!role) throw new Error("Role not found");

    if (role.isSystem) {
      if (patch.permissions !== undefined || patch.includes !== undefined) {
        throw new RoleValidationError(
          "system role permissions and includes cannot be edited",
          {
            permissions: "cannot edit system role permissions",
          },
        );
      }
    }

    if (patch.name !== undefined) role.name = patch.name;
    if (patch.description !== undefined) role.description = patch.description;

    if (!role.isSystem) {
      if (patch.permissions !== undefined) role.permissions = patch.permissions;
      if (patch.includes !== undefined) role.includes = patch.includes;

      await this.validatePermissionsAndIncludes(
        role.key,
        role.permissions,
        role.includes,
        actorPermissions,
        patch.permissions,
      );
    }

    // Persist before recompute — recompute reloads from DB and would discard
    // in-memory permission/include changes if we skip save.
    await role.save();
    await this.recompute(role.key);
    const refreshed = await RoleModel.findOne({ key }).exec();
    if (!refreshed) throw new Error("Role not found");
    return toOut(
      refreshed,
      await assignedCount(key),
      await countActiveSuperAdmins(),
    );
  }

  async delete(key: string, force: boolean): Promise<void> {
    const role = await RoleModel.findOne({ key }).exec();
    if (!role) throw new Error("Role not found");
    if (role.isSystem) {
      throw new RoleValidationError("system roles cannot be deleted");
    }

    if (key === "super_admin") {
      throw new RoleValidationError("system roles cannot be deleted");
    }

    const count = await assignedCount(key);
    if (count > 0 && !force) {
      throw new RoleConflictError("Role is still assigned to users", count);
    }

    if (force && count > 0) {
      await UserModel.updateMany(
        { roles: key },
        { $pull: { roles: key } },
      ).exec();
    }

    await RoleModel.deleteOne({ key }).exec();
    invalidateAll();
  }

  async recompute(roleKey: string): Promise<void> {
    const deprecated = await deprecatedKeys();
    const allRoles = await RoleModel.find().exec();
    const includePermissions = new Map(
      allRoles.map((r) => [r.key, r.permissions] as const),
    );

    const role = allRoles.find((r) => r.key === roleKey);
    if (!role) return;

    role.effectivePermissions = computeEffective(
      role.permissions,
      role.includes,
      includePermissions,
      deprecated,
    );
    await role.save();

    for (const other of allRoles) {
      if (!other.includes.includes(roleKey)) continue;
      other.effectivePermissions = computeEffective(
        other.permissions,
        other.includes,
        includePermissions,
        deprecated,
      );
      await other.save();
    }

    invalidateAll();
  }

  async assignUserRoles(
    userId: string,
    roles: string[],
    actorId: string,
    actorPermissions: Set<string>,
  ): Promise<string[]> {
    if (userId === actorId && !actorPermissions.has("*")) {
      throw new RoleValidationError(
        "Cannot assign roles to yourself unless you hold *",
      );
    }

    const uniqueRoles = [...new Set(roles)];
    const roleDocs = await RoleModel.find({ key: { $in: uniqueRoles } }).exec();
    if (roleDocs.length !== uniqueRoles.length) {
      throw new RoleValidationError("One or more roles do not exist", {
        roles: "unknown role key",
      });
    }

    if (!actorPermissions.has("*")) {
      for (const role of roleDocs) {
        for (const perm of role.effectivePermissions) {
          if (perm === "*") {
            throw new RoleValidationError(
              "Cannot assign a role containing permissions you lack",
            );
          }
          if (!actorPermissions.has(perm)) {
            throw new RoleValidationError(
              "Cannot assign a role containing permissions you lack",
              { roles: `missing permission ${perm}` },
            );
          }
        }
      }
    }

    const user = await UserModel.findById(userId).exec();
    if (!user) throw new Error("User not found");

    const hadSuper = (user.roles ?? []).includes("super_admin");
    const willHaveSuper = uniqueRoles.includes("super_admin");
    if (hadSuper && !willHaveSuper && !user.isBlocked) {
      const active = await countActiveSuperAdmins();
      if (active <= 1) {
        throw new RoleValidationError("Cannot remove the last super_admin");
      }
    }

    user.roles = uniqueRoles;
    await user.save();
    invalidateUser(userId);
    return uniqueRoles;
  }

  private async loadIncludePermissions(
    includes: string[],
  ): Promise<Map<string, string[]>> {
    const docs = await RoleModel.find({ key: { $in: includes } }).exec();
    return new Map(docs.map((d) => [d.key, d.permissions] as const));
  }

  private async validatePermissionsAndIncludes(
    roleKey: string,
    permissions: string[],
    includes: string[],
    actorPermissions: Set<string>,
    addedPermissions?: string[],
  ): Promise<void> {
    const fields: Record<string, string> = {};
    const deprecated = await deprecatedKeys();

    for (const key of permissions) {
      if (key === "*") {
        if (roleKey !== "super_admin") {
          fields.permissions = "* is only allowed on super_admin";
        }
        continue;
      }
      if (!has(key)) {
        fields.permissions = `unknown permission ${key}`;
      } else if (deprecated.has(key)) {
        fields.permissions = `deprecated permission ${key}`;
      }
    }

    const toCheck = addedPermissions ?? permissions;
    if (!actorPermissions.has("*")) {
      for (const key of toCheck) {
        if (key === "*") continue;
        if (!actorPermissions.has(key)) {
          fields.permissions = `cannot grant permission you do not hold: ${key}`;
        }
      }
    }

    if (includes.includes(roleKey)) {
      fields.includes = "role cannot include itself";
    }

    const includeDocs = await RoleModel.find({ key: { $in: includes } }).exec();
    if (includeDocs.length !== includes.length) {
      fields.includes = "unknown included role";
    }
    for (const doc of includeDocs) {
      if (doc.includes.length > 0) {
        fields.includes =
          "included role must not itself include roles (max 1 level)";
      }
    }

    if (Object.keys(fields).length > 0) {
      throw new RoleValidationError("Validation failed", fields);
    }
  }
}

export const roleService = new RoleService();
