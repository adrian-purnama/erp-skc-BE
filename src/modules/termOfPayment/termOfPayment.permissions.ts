import type { PermissionDef } from "../admin/admin.permissions";

export const TERM_OF_PAYMENT_PERMS = [
  { key: "termOfPayment.view", label: "View terms of payment" },
  {
    key: "termOfPayment.manage",
    label: "Manage terms of payment",
    implies: ["termOfPayment.view"],
  },
] as const satisfies readonly PermissionDef[];
