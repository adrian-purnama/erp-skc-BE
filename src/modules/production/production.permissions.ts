import type { PermissionDef } from "../admin/admin.permissions";

export const PRODUCTION_PERMS = [
  { key: "production.view", label: "View production" },
  {
    key: "production.report",
    label: "Report production output",
    implies: ["production.view"],
  },
  {
    key: "production.viewAll",
    label: "See every SPK (not only the ones assigned to you)",
    implies: ["production.view"],
  },
  {
    key: "production.manage",
    label: "Release projects and manage SPK",
    implies: ["production.view", "production.report"],
  },
] as const satisfies readonly PermissionDef[];
