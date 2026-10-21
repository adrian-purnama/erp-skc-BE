import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import express from "express";
import { requireUser } from "../../middleware/requireUser";
import {
  publicRoute,
  requirePermission,
} from "./requirePermission";
import {
  createRouter,
  mountRouter,
  resetMountRecordsForTests,
} from "./routing";
import { scanRoutes } from "./scan";
import { formatViolations, planScanViolations, validateScan } from "./sync";
import { requireLabels } from "./registry";

describe("scan and validate", () => {
  beforeEach(() => {
    resetMountRecordsForTests();
  });

  it("finds nested router routes with full paths", () => {
    const app = express();
    const parent = createRouter();
    const child = createRouter();
    child.get(
      "/item",
      requireUser,
      requirePermission({ key: "admin.user.view" }),
      (_req, res) => res.end(),
    );
    mountRouter(app, "/admin", parent, "/tmp/admin.route.ts");
    mountRouter(parent, "/extra", child, "/tmp/extra.route.ts");

    const scan = scanRoutes(app);
    const hit = scan.routes.find(
      (r) => r.method === "GET" && r.path === "/admin/extra/item",
    );
    assert.ok(hit);
    assert.equal(hit!.category, "extra");
    assert.equal(hit!.authType, "permission");
    assert.equal(hit!.permissionKey, "admin.user.view");
  });

  it("fails strict mode for unprotected routes and warns when not strict", () => {
    const app = express();
    const router = createRouter();
    router.get("/open", (_req, res) => res.end());
    mountRouter(app, "/x", router, "/tmp/x.route.ts");
    const scan = scanRoutes(app);

    assert.throws(() => validateScan(scan, true));

    const violations = planScanViolations(scan);
    assert.ok(violations.some((v) => v.kind === "unprotected"));
    assert.doesNotThrow(() => validateScan(scan, false));
  });

  it("fails on unknown permission keys", () => {
    const app = express();
    const router = createRouter();
    router.get(
      "/y",
      requireUser,
      requirePermission({ key: "not.a.real.perm" }),
      (_req, res) => res.end(),
    );
    mountRouter(app, "/x", router, "/tmp/x.route.ts");
    const scan = scanRoutes(app);
    const violations = planScanViolations(scan);
    assert.ok(violations.some((v) => v.kind === "unknown_permission"));
  });

  it("treats unregistered app.get as a violation; /health is allowlisted", () => {
    const app = express();
    app.get("/health", (_req, res) => res.end());
    app.get("/x", (_req, res) => res.end());
    const scan = scanRoutes(app);
    assert.ok(
      scan.unregistered.some((u) => u.method === "GET" && u.path === "/x"),
    );
    assert.ok(
      !scan.unregistered.some(
        (u) => u.method === "GET" && u.path === "/health",
      ),
    );
    assert.throws(() => validateScan(scan, true));
  });

  it("reports wrapped requirePermission as unprotected", () => {
    const app = express();
    const router = createRouter();
    const wrapped = (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => requirePermission({ key: "admin.user.view" })(req, res, next);
    router.get("/z", wrapped, (_req, res) => res.end());
    mountRouter(app, "/x", router, "/tmp/x.route.ts");
    const scan = scanRoutes(app);
    const route = scan.routes.find((r) => r.path === "/x/z");
    assert.equal(route?.authType, "none");
    const violations = planScanViolations(scan);
    assert.ok(
      violations.some((v) => v.path === "/x/z" && v.kind === "unprotected"),
    );
  });

  it("reports router.use(requireUser) as router-level violation", () => {
    const app = express();
    const router = createRouter();
    router.use(requireUser);
    router.get("/z", publicRoute(), (_req, res) => res.end());
    mountRouter(app, "/x", router, "/tmp/x.route.ts");
    const scan = scanRoutes(app);
    assert.ok(scan.violations.some((v) => v.kind === "router_level_meta"));
    assert.match(
      formatViolations(scan.violations),
      /router-level auth middleware/,
    );
  });

  it("requireLabels returns empty for current registry", () => {
    assert.deepEqual(requireLabels(), []);
  });
});
