import type { Application, IRouter } from "express";
import {
  getMountRecords,
  isRecordedRouter,
  joinPaths,
  type MountRecord,
} from "./routing";
import type { HandlerMeta } from "./requirePermission";

export type ScanAuthType = "permission" | "auth" | "public" | "none";

export type ScannedRoute = {
  method: string;
  path: string;
  category: string;
  authType: ScanAuthType;
  permissionKey?: string;
};

export type ScanViolation = {
  kind:
    | "unprotected"
    | "unknown_permission"
    | "unregistered"
    | "router_level_meta"
    | "missing_label";
  message: string;
  method?: string;
  path?: string;
};

export type ScanResult = {
  routes: ScannedRoute[];
  violations: ScanViolation[];
  authOnly: ScannedRoute[];
  unregistered: Array<{ method: string; path: string }>;
};

type LayerLike = {
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: Array<{ handle: { meta?: HandlerMeta } }>;
  };
  handle?: unknown;
  name?: string;
  regexp?: { fast_slash?: boolean };
  keys?: Array<{ name: string }>;
};

let lastScan: ScanResult | null = null;

function readMeta(
  handlers: Array<{ handle: { meta?: HandlerMeta } }>,
): { authType: ScanAuthType; permissionKey?: string } {
  let authType: ScanAuthType = "none";
  let permissionKey: string | undefined;

  for (const layer of handlers) {
    const meta = layer.handle?.meta;
    if (!meta) continue;
    if (meta.type === "permission") {
      authType = "permission";
      permissionKey = meta.key;
    } else if (meta.type === "auth" && authType !== "permission") {
      authType = "auth";
    } else if (meta.type === "public" && authType === "none") {
      authType = "public";
    }
  }

  return { authType, permissionKey };
}

function scanRecordedRouter(mount: MountRecord): {
  routes: ScannedRoute[];
  violations: ScanViolation[];
} {
  const routes: ScannedRoute[] = [];
  const violations: ScanViolation[] = [];
  const stack =
    (mount.router as unknown as { stack?: LayerLike[] }).stack ?? [];

  for (const layer of stack) {
    if (layer.route) {
      const routePath = Array.isArray(layer.route.path)
        ? layer.route.path[0]
        : layer.route.path;
      const fullPath = joinPaths(mount.basePath, routePath);
      const { authType, permissionKey } = readMeta(layer.route.stack);
      const methods = Object.keys(layer.route.methods)
        .filter((m) => layer.route!.methods[m])
        .map((m) => m.toUpperCase());

      for (const method of methods) {
        routes.push({
          method,
          path: fullPath,
          category: mount.category,
          authType,
          permissionKey,
        });
      }
      continue;
    }

    const handle = layer.handle as { meta?: HandlerMeta } | undefined;
    if (handle?.meta) {
      violations.push({
        kind: "router_level_meta",
        message:
          "router-level auth middleware is not supported; apply per route",
        path: mount.basePath,
      });
    }
  }

  return { routes, violations };
}

function getAppStack(app: Application): LayerLike[] {
  const router = (app as unknown as { router?: { stack?: LayerLike[] } }).router;
  return router?.stack ?? [];
}

function pathFromLayer(layer: LayerLike): string | undefined {
  if (layer.route) {
    const p = Array.isArray(layer.route.path)
      ? layer.route.path[0]
      : layer.route.path;
    return p.startsWith("/") ? p : `/${p}`;
  }
  return undefined;
}

function isRouterHandle(handle: unknown): handle is IRouter {
  return (
    typeof handle === "function" &&
    handle !== null &&
    "stack" in (handle as object)
  );
}

const HEALTH_ALLOWLIST = new Set(["GET /health"]);

function scanUnregistered(
  app: Application,
): Array<{ method: string; path: string }> {
  const found: Array<{ method: string; path: string }> = [];
  const stack = getAppStack(app);

  for (const layer of stack) {
    if (layer.route) {
      const routePath = pathFromLayer(layer) ?? "/";
      const methods = Object.keys(layer.route.methods)
        .filter((m) => layer.route!.methods[m])
        .map((m) => m.toUpperCase());
      for (const method of methods) {
        const key = `${method} ${routePath}`;
        if (HEALTH_ALLOWLIST.has(key)) continue;
        found.push({ method, path: routePath });
      }
      continue;
    }

    if (isRouterHandle(layer.handle) && !isRecordedRouter(layer.handle)) {
      found.push({ method: "*", path: "(unrecorded router)" });
    }
  }

  return found;
}

export function scanRoutes(app: Application): ScanResult {
  const routes: ScannedRoute[] = [];
  const violations: ScanViolation[] = [];

  for (const mount of getMountRecords()) {
    const scanned = scanRecordedRouter(mount);
    routes.push(...scanned.routes);
    violations.push(...scanned.violations);
  }

  const unregistered = scanUnregistered(app);
  for (const entry of unregistered) {
    violations.push({
      kind: "unregistered",
      message: `unregistered route ${entry.method} ${entry.path}`,
      method: entry.method,
      path: entry.path,
    });
  }

  const authOnly = routes.filter((r) => r.authType === "auth");
  const result: ScanResult = { routes, violations, authOnly, unregistered };
  lastScan = result;
  return result;
}

export function getLastScan(): ScanResult | null {
  return lastScan;
}
