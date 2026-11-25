import type { PermissionDef } from "../../core/permissions/types";

export const UOM_PERMS = [
  { key: "uom.view", label: "View units of measure" },
  {
    key: "uom.manage",
    label: "Manage units of measure",
    implies: ["uom.view"],
  },
] as const satisfies readonly PermissionDef[];
