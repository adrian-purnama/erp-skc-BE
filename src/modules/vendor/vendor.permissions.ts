import type { PermissionDef } from "../../core/permissions/types";

export const VENDOR_PERMS = [
  { key: "vendor.view", label: "View vendors" },
  {
    key: "vendor.manage",
    label: "Manage vendors",
    implies: ["vendor.view"],
  },
] as const satisfies readonly PermissionDef[];
