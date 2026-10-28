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
    key: "purchasing.manage",
    label: "Manage purchasing (purchase orders, any SPP)",
    implies: ["purchasing.view", "purchasing.request", "purchasing.viewAll"],
  },
  {
    key: "purchasing.realize",
    label: "Record purchase realization (nota)",
    implies: ["purchasing.view", "purchasing.viewAll"],
  },
  {
    key: "purchasing.receive",
    label: "Receive goods (penerimaan barang)",
    implies: ["purchasing.view", "purchasing.viewAll"],
  },
  {
    key: "purchasing.approve",
    label: "Approve purchase orders",
    implies: ["purchasing.view", "purchasing.viewAll"],
  },
] as const satisfies readonly PermissionDef[];
