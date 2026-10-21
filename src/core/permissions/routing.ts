import { Router, type Express, type IRouter } from "express";
import path from "node:path";

/**
 * requireUser, requirePermission, and publicRoute must be passed directly in
 * each route's handler list. They must not be wrapped (e.g.
 * asyncHandler(requirePermission(...))) and must not be applied with
 * router.use. The scanner reads handler.meta only from per-route handlers.
 */

export type MountRecord = {
  parentBasePath: string;
  basePath: string;
  router: IRouter;
  category: string;
};

const mounts: MountRecord[] = [];
const routerBasePaths = new Map<object, string>();

export function createRouter(): Router {
  return Router();
}

export function categoryFromFilePath(filePath: string): string {
  const base = path.basename(filePath);
  if (base.endsWith(".routes.ts")) return base.slice(0, -".routes.ts".length);
  if (base.endsWith(".route.ts")) return base.slice(0, -".route.ts".length);
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

export function joinPaths(parent: string, child: string): string {
  const left = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  const right = child.startsWith("/") ? child : `/${child}`;
  if (right === "/") return left || "/";
  if (!left) return right || "/";
  return `${left}${right}` || "/";
}

export function mountRouter(
  parent: Express | IRouter,
  basePath: string,
  router: IRouter,
  filePath: string,
): void {
  const parentBase = routerBasePaths.get(parent as object) ?? "";
  const fullBase = joinPaths(parentBase, basePath);
  const category = categoryFromFilePath(filePath);

  mounts.push({
    parentBasePath: parentBase,
    basePath: fullBase,
    router,
    category,
  });
  routerBasePaths.set(router as object, fullBase);

  (parent as IRouter).use(basePath, router);
}

export function getMountRecords(): readonly MountRecord[] {
  return mounts;
}

export function resetMountRecordsForTests(): void {
  mounts.length = 0;
  routerBasePaths.clear();
}

export function isRecordedRouter(handle: unknown): boolean {
  return mounts.some((m) => m.router === handle);
}
