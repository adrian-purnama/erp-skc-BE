import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PermissionInterface } from "./permission.model";
import type { ScannedRoute } from "./scan";
import { planPermissionSync } from "./sync";

function existing(
  partial: Partial<PermissionInterface> & { key: string },
): PermissionInterface {
  return {
    label: partial.label ?? partial.key,
    category: partial.category ?? "admin",
    routes: partial.routes ?? [],
    status: partial.status ?? "active",
    manual: partial.manual ?? false,
    missCount: partial.missCount ?? 0,
    firstSeenAt: partial.firstSeenAt,
    lastSeenAt: partial.lastSeenAt,
    deprecatedAt: partial.deprecatedAt,
    ...partial,
  };
}

describe("planPermissionSync missCount", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("first miss keeps active with missCount 1", () => {
    const plan = planPermissionSync(
      [],
      [
        existing({
          key: "admin.config.view",
          status: "active",
          missCount: 0,
        }),
      ],
      now,
    );
    const row = plan.upserts.find((p) => p.key === "admin.config.view");
    assert.equal(row?.status, "active");
    assert.equal(row?.missCount, 1);
    assert.equal(plan.summary.pendingDeprecation >= 1, true);
  });

  it("second miss deprecates", () => {
    const plan = planPermissionSync(
      [],
      [
        existing({
          key: "admin.config.view",
          status: "active",
          missCount: 1,
        }),
      ],
      now,
    );
    const row = plan.upserts.find((p) => p.key === "admin.config.view");
    assert.equal(row?.status, "deprecated");
    assert.equal(row?.missCount, 2);
  });

  it("reappearing resets missCount and reactivates", () => {
    const routes: ScannedRoute[] = [
      {
        method: "GET",
        path: "/admin/app-config",
        category: "admin",
        authType: "permission",
        permissionKey: "admin.config.view",
      },
    ];
    const plan = planPermissionSync(
      routes,
      [
        existing({
          key: "admin.config.view",
          status: "deprecated",
          missCount: 2,
          deprecatedAt: now,
        }),
      ],
      now,
    );
    const row = plan.upserts.find((p) => p.key === "admin.config.view");
    assert.equal(row?.status, "active");
    assert.equal(row?.missCount, 0);
  });

  it("never-active unrouted stays unused without bumping missCount", () => {
    const plan = planPermissionSync(
      [],
      [
        existing({
          key: "admin.config.view",
          status: "unused",
          missCount: 0,
        }),
      ],
      now,
    );
    const row = plan.upserts.find((p) => p.key === "admin.config.view");
    assert.equal(row?.status, "unused");
    assert.equal(row?.missCount, 0);
  });

  it("manual keys never accumulate missCount when unrouted", () => {
    const plan = planPermissionSync(
      [],
      [
        existing({
          key: "admin.manual.thing",
          status: "active",
          manual: true,
          missCount: 0,
          category: "manual",
        }),
      ],
      now,
      [
        {
          key: "admin.manual.thing",
          label: "Manual thing",
          manual: true,
        },
      ],
    );
    const row = plan.upserts.find((p) => p.key === "admin.manual.thing");
    assert.equal(row?.status, "active");
    assert.equal(row?.missCount, 0);
    assert.equal(row?.category, "manual");
  });
});
