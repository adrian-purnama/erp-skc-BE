import { logger } from "../logger";
import { RoleModel } from "../../models/role.model";
import { computeEffective } from "../../modules/admin/roles/role.service";
import {
  PermissionModel,
  type PermissionInterface,
  type PermissionStatus,
} from "../../models/permission.model";
import { all, get, has, requireLabels } from "./registry";
import { invalidateAll } from "./resolve.service";
import type { ScanResult, ScanViolation, ScannedRoute } from "./scan";

const logSource = "core/permissions/sync.ts";

// Each environment and each branch must use its own database, because sync is
// destructive to effective permissions.

export type PlannedPermission = {
  key: string;
  label: string;
  category: string;
  routes: Array<{ method: string; path: string }>;
  status: PermissionStatus;
  manual: boolean;
  missCount: number;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  deprecatedAt?: Date | null;
  isNew: boolean;
};

export type PermissionSyncPlan = {
  upserts: PlannedPermission[];
  summary: {
    active: number;
    unused: number;
    deprecated: number;
    newCount: number;
    pendingDeprecation: number;
  };
  categoryWarnings: string[];
};

export function planScanViolations(
  scan: ScanResult,
  labelOffenders: string[] = requireLabels(),
): ScanViolation[] {
  const violations: ScanViolation[] = [...scan.violations];

  for (const route of scan.routes) {
    if (route.authType === "none") {
      violations.push({
        kind: "unprotected",
        message: `unprotected route ${route.method} ${route.path}`,
        method: route.method,
        path: route.path,
      });
    }
    if (
      route.authType === "permission" &&
      route.permissionKey &&
      !has(route.permissionKey)
    ) {
      violations.push({
        kind: "unknown_permission",
        message: `unknown permission ${route.permissionKey} on ${route.method} ${route.path}`,
        method: route.method,
        path: route.path,
      });
    }
  }

  for (const key of labelOffenders) {
    violations.push({
      kind: "missing_label",
      message: `registry entry missing label: ${key}`,
    });
  }

  return violations;
}

export function formatViolations(violations: ScanViolation[]): string {
  return violations
    .map((v) => {
      if (v.method && v.path) return `${v.message} (${v.method} ${v.path})`;
      return v.message;
    })
    .join("; ");
}

export function validateScan(
  scan: ScanResult,
  strict: boolean,
): ScanViolation[] {
  const violations = planScanViolations(scan);
  if (violations.length > 0) {
    const message = formatViolations(violations);
    if (strict) {
      throw new Error(message);
    }
    logger.warn(message, logSource, "validateScan");
  }

  if (scan.authOnly.length > 0) {
    const list = scan.authOnly
      .map((r) => `${r.method} ${r.path}`)
      .join(", ");
    logger.warn(`auth-only routes: ${list}`, logSource, "validateScan");
  }

  return violations;
}

function routesForKey(routes: ScannedRoute[], key: string) {
  return routes
    .filter((r) => r.permissionKey === key)
    .map((r) => ({ method: r.method, path: r.path, category: r.category }));
}

export function planPermissionSync(
  scanRoutes: ScannedRoute[],
  existing: PermissionInterface[],
  now: Date = new Date(),
  registryDefs: ReturnType<typeof all> = all(),
): PermissionSyncPlan {
  const existingByKey = new Map(existing.map((p) => [p.key, p]));
  const upserts: PlannedPermission[] = [];
  const categoryWarnings: string[] = [];
  const seenKeys = new Set<string>();

  for (const def of registryDefs) {
    seenKeys.add(def.key);
    const used = routesForKey(scanRoutes, def.key);
    const prev = existingByKey.get(def.key);
    const isNew = !prev;

    if (used.length > 0) {
      const categories = [...new Set(used.map((r) => r.category))];
      const category = categories[0]!;
      if (categories.length > 1) {
        categoryWarnings.push(
          `permission ${def.key} used in multiple categories: ${categories.join(", ")}; keeping ${category}`,
        );
      }
      upserts.push({
        key: def.key,
        label: def.label,
        category,
        routes: used.map(({ method, path }) => ({ method, path })),
        status: "active",
        manual: Boolean(def.manual),
        missCount: 0,
        firstSeenAt: prev?.firstSeenAt ?? now,
        lastSeenAt: now,
        deprecatedAt: null,
        isNew,
      });
      continue;
    }

    if (def.manual) {
      upserts.push({
        key: def.key,
        label: def.label,
        category: "manual",
        routes: [],
        status: "active",
        manual: true,
        missCount: prev?.missCount ?? 0,
        firstSeenAt: prev?.firstSeenAt ?? now,
        lastSeenAt: prev?.lastSeenAt,
        deprecatedAt: prev?.deprecatedAt ?? null,
        isNew,
      });
      continue;
    }

    if (prev?.status === "active") {
      const missCount = (prev.missCount ?? 0) + 1;
      const deprecated = missCount >= 2;
      upserts.push({
        key: def.key,
        label: def.label,
        category: prev.category,
        routes: [],
        status: deprecated ? "deprecated" : "active",
        manual: false,
        missCount,
        firstSeenAt: prev.firstSeenAt,
        lastSeenAt: prev.lastSeenAt,
        deprecatedAt: deprecated ? (prev.deprecatedAt ?? now) : null,
        isNew: false,
      });
      continue;
    }

    upserts.push({
      key: def.key,
      label: def.label,
      category: prev?.category ?? "unused",
      routes: [],
      status: prev?.status === "deprecated" ? "deprecated" : "unused",
      manual: false,
      missCount: prev?.missCount ?? 0,
      firstSeenAt: prev?.firstSeenAt,
      lastSeenAt: prev?.lastSeenAt,
      deprecatedAt: prev?.deprecatedAt ?? null,
      isNew,
    });
  }

  for (const prev of existing) {
    if (seenKeys.has(prev.key)) continue;

    if (prev.status === "active" && !prev.manual) {
      const missCount = (prev.missCount ?? 0) + 1;
      const deprecated = missCount >= 2;
      upserts.push({
        key: prev.key,
        label: prev.label,
        category: prev.category,
        routes: [],
        status: deprecated ? "deprecated" : "active",
        manual: false,
        missCount,
        firstSeenAt: prev.firstSeenAt,
        lastSeenAt: prev.lastSeenAt,
        deprecatedAt: deprecated ? (prev.deprecatedAt ?? now) : null,
        isNew: false,
      });
      continue;
    }

    upserts.push({
      key: prev.key,
      label: prev.label,
      category: prev.category,
      routes: prev.routes ?? [],
      status: prev.status === "active" ? "unused" : prev.status,
      manual: prev.manual,
      missCount: prev.missCount ?? 0,
      firstSeenAt: prev.firstSeenAt,
      lastSeenAt: prev.lastSeenAt,
      deprecatedAt: prev.deprecatedAt ?? null,
      isNew: false,
    });
  }

  const summary = {
    active: upserts.filter((p) => p.status === "active").length,
    unused: upserts.filter((p) => p.status === "unused").length,
    deprecated: upserts.filter((p) => p.status === "deprecated").length,
    newCount: upserts.filter((p) => p.isNew).length,
    pendingDeprecation: upserts.filter(
      (p) => p.status === "active" && p.missCount === 1,
    ).length,
  };

  return { upserts, summary, categoryWarnings };
}

export async function syncPermissions(
  scan: ScanResult,
): Promise<PermissionSyncPlan> {
  const existing = await PermissionModel.find().exec();
  const plan = planPermissionSync(scan.routes, existing);

  for (const warning of plan.categoryWarnings) {
    logger.warn(warning, logSource, "syncPermissions");
  }

  for (const item of plan.upserts) {
    const existingDoc = await PermissionModel.findOne({ key: item.key }).exec();
    if (existingDoc) {
      existingDoc.label = item.label;
      existingDoc.category = item.category;
      existingDoc.routes = item.routes;
      existingDoc.status = item.status;
      existingDoc.manual = item.manual;
      existingDoc.missCount = item.missCount;
      if (item.lastSeenAt) existingDoc.lastSeenAt = item.lastSeenAt;
      existingDoc.deprecatedAt = item.deprecatedAt ?? undefined;
      await existingDoc.save();
    } else {
      await PermissionModel.create({
        key: item.key,
        label: item.label,
        category: item.category,
        routes: item.routes,
        status: item.status,
        manual: item.manual,
        missCount: item.missCount,
        firstSeenAt: item.firstSeenAt ?? new Date(),
        lastSeenAt: item.lastSeenAt,
        deprecatedAt: item.deprecatedAt ?? undefined,
      });
    }
  }

  logger.info(
    `permissions sync: active=${plan.summary.active} unused=${plan.summary.unused} deprecated=${plan.summary.deprecated} new=${plan.summary.newCount} pendingDeprecation=${plan.summary.pendingDeprecation} unprotected=${scan.routes.filter((r) => r.authType === "none").length} authOnly=${scan.authOnly.length}`,
    logSource,
    "syncPermissions",
  );

  return plan;
}

export async function recomputeAllRoles(): Promise<void> {
  const roles = await RoleModel.find().exec();
  const deprecatedDocs = await PermissionModel.find({
    status: "deprecated",
  }).exec();
  const deprecated = new Set(deprecatedDocs.map((d) => d.key));

  const includeMap = new Map(
    roles.map((r) => [r.key, r.permissions] as const),
  );

  for (const role of roles) {
    role.effectivePermissions = computeEffective(
      role.permissions,
      role.includes,
      includeMap,
      deprecated,
    );
    await role.save();
  }

  invalidateAll();
}

export async function seedRoles(): Promise<void> {
  await RoleModel.findOneAndUpdate(
    { key: "super_admin" },
    {
      $set: {
        name: "Super Admin",
        permissions: ["*"],
        includes: [],
        effectivePermissions: ["*"],
        isSystem: true,
      },
      $setOnInsert: {
        description: "Full access",
      },
    },
    { upsert: true },
  ).exec();

  const existingUserAdmin = await RoleModel.findOne({ key: "user_admin" }).exec();
  if (!existingUserAdmin) {
    await RoleModel.create({
      key: "user_admin",
      name: "User Admin",
      description: "Manage users and view config",
      permissions: ["admin.user.manage", "admin.config.view"],
      includes: [],
      effectivePermissions: [],
      isSystem: false,
    });
  }

  await recomputeAllRoles();
}
