import type { PermissionDef } from "../admin/admin.permissions";

export const QUOTATION_PERMS = [
  { key: "quotation.view", label: "View quotations" },
  {
    key: "quotation.manage",
    label: "Manage quotations",
    implies: ["quotation.view"],
  },
] as const satisfies readonly PermissionDef[];
