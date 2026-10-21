import type { PermissionDef } from "../admin/admin.permissions";

export const ITEM_MASTER_PERMS = [
  { key: "itemMaster.view", label: "View item master" },
  {
    key: "itemMaster.manage",
    label: "Manage item master",
    implies: ["itemMaster.view"],
  },
] as const satisfies readonly PermissionDef[];
