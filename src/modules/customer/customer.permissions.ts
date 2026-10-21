import type { PermissionDef } from "../admin/admin.permissions";

export const CUSTOMER_PERMS = [
  { key: "customer.view", label: "View customers" },
  {
    key: "customer.manage",
    label: "Manage customers",
    implies: ["customer.view"],
  },
] as const satisfies readonly PermissionDef[];
