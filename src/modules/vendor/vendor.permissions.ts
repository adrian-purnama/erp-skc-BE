import type { PermissionDef } from "../admin/admin.permissions";

export const VENDOR_PERMS = [
  { key: "vendor.view", label: "View vendors" },
  {
    key: "vendor.manage",
    label: "Manage vendors",
    implies: ["vendor.view"],
  },
] as const satisfies readonly PermissionDef[];
