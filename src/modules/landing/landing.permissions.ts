import type { PermissionDef } from "../../core/permissions/types";

export const LANDING_PERMS = [
  { key: "landing.view", label: "View website content" },
  {
    key: "landing.manage",
    label: "Manage website content",
    implies: ["landing.view"],
  },
] as const satisfies readonly PermissionDef[];
