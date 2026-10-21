import type { PermissionDef } from "../admin/admin.permissions";

export const UOM_PERMS = [
  { key: "uom.view", label: "View units of measure" },
  {
    key: "uom.manage",
    label: "Manage units of measure",
    implies: ["uom.view"],
  },
] as const satisfies readonly PermissionDef[];
