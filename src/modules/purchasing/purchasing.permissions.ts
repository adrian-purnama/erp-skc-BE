import type { PermissionDef } from "../admin/admin.permissions";

export const PURCHASING_PERMS = [
  { key: "purchasing.view", label: "View your material requests (SPP)" },
  {
    key: "purchasing.request",
    label: "Request materials (SPP)",
    implies: ["purchasing.view"],
  },
  {
    key: "purchasing.viewAll",
    label: "See every material request (not only your own)",
    implies: ["purchasing.view"],
  },
  {
    key: "purchasing.rab",
    label: "Manage purchasing RABs (budgets outside the BOQ)",
    implies: ["purchasing.view"],
  },
  {
    key: "purchasing.manage",
    label: "Manage purchasing (purchase orders, any SPP, RABs)",
    implies: ["purchasing.view", "purchasing.request", "purchasing.viewAll", "purchasing.rab"],
  },
  {
    key: "purchasing.realize",
    label: "Record realizations (Penerimaan from vendor / Nota Realisasi by staff)",
    implies: ["purchasing.view", "purchasing.viewAll"],
  },
  {
    key: "purchasing.approve",
    label: "Approve purchase orders (level 1)",
    implies: ["purchasing.view", "purchasing.viewAll"],
    // Checked in the PO service against the approver chosen on the PO, not on a route.
    manual: true,
  },
  {
    key: "purchasing.approve2",
    label: "Approve purchase orders (level 2)",
    implies: ["purchasing.view", "purchasing.viewAll"],
    manual: true,
  },
  {
    key: "purchasing.pay",
    label: "Pay approved vendor payments and reimbursements (finance)",
    implies: ["purchasing.view", "purchasing.viewAll"],
  },
] as const satisfies readonly PermissionDef[];
