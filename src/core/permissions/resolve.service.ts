import type { HydratedDocument } from "mongoose";
import { UserModel, type UserInterface } from "../../models/user.model";
import { RoleModel } from "../../models/role.model";

// Multi-instance deployments need a shared cache (e.g. Redis) with the same interface.
const CACHE_TTL_MS = 60_000;

type CacheEntry = {
  permissions: Set<string>;
  cachedAt: number;
};

const cache = new Map<string, CacheEntry>();

export function invalidateUser(id: string): void {
  cache.delete(id);
}

export function invalidateAll(): void {
  cache.clear();
}

export async function getUserPermissions(
  user: HydratedDocument<UserInterface> | { id: string; roles?: string[] },
  now: number = Date.now(),
): Promise<Set<string>> {
  const userId = user.id;
  const roles = user.roles ?? [];

  if (roles.length === 0) {
    return new Set();
  }

  const cached = cache.get(userId);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return new Set(cached.permissions);
  }

  const roleDocs = await RoleModel.find({ key: { $in: roles } }).exec();
  const permissions = new Set<string>();
  for (const role of roleDocs) {
    for (const perm of role.effectivePermissions) {
      permissions.add(perm);
    }
  }

  cache.set(userId, { permissions, cachedAt: now });
  return new Set(permissions);
}

/** A user who holds a permission (plain data, safe to pass between modules). */
export type PermittedUserDto = {
  id: string;
  fullName: string;
  email: string;
};

/** Non-blocked users whose roles grant `key` (or `*`), sorted by name. */
export async function usersWithPermission(key: string): Promise<PermittedUserDto[]> {
  const roles = await RoleModel.find({ effectivePermissions: { $in: [key, "*"] } })
    .select({ key: 1 })
    .lean()
    .exec();
  if (roles.length === 0) return [];
  const users = await UserModel.find({
    roles: { $in: roles.map((r) => r.key) },
    isBlocked: { $ne: true },
  })
    .select({ fullName: 1, email: 1 })
    .sort({ fullName: 1, email: 1 })
    .lean()
    .exec();
  return users.map((u) => ({
    id: String(u._id),
    fullName: u.fullName?.trim() ?? "",
    email: u.email ?? "",
  }));
}

/** Whether a non-blocked user's roles grant `key` (or `*`). */
export async function userHasPermission(userId: string, key: string): Promise<boolean> {
  const user = await UserModel.findById(userId).select({ roles: 1, isBlocked: 1 }).lean().exec();
  if (!user || user.isBlocked) return false;
  const perms = await getUserPermissions({ id: String(user._id), roles: user.roles ?? [] });
  return perms.has(key) || perms.has("*");
}
