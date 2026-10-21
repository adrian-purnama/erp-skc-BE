import type { HydratedDocument } from "mongoose";
import type { UserInterface } from "../../models/user/user.model";
import { RoleModel } from "../../modules/admin/roles/role.model";

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

export const CACHE_TTL_MS_FOR_TESTS = CACHE_TTL_MS;
