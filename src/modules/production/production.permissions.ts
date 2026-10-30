import type { PermissionDef } from "../admin/admin.permissions";

export const PRODUCTION_PERMS = [
  { key: "production.view", label: "View production" },
  {
    key: "production.report",
    label: "Report production output",
    implies: ["production.view"],
  },
  {
    key: "production.handover",
    label: "Record vendor handovers (subcon / outsource)",
    implies: ["production.view"],
  },
  {
    key: "production.dispatch",
    label: "Request and send material to subcon vendors (surat jalan)",
    implies: ["production.view"],
  },
  {
    key: "production.dispatchApprove",
    label: "Approve sending material to subcon vendors",
    implies: ["production.view"],
  },
  {
    key: "production.viewAll",
    label: "See every SPK (not only the ones assigned to you)",
    implies: ["production.view"],
    // Checked in the SPK list controller, not on a route.
    manual: true,
  },
  {
    key: "production.manage",
    label: "Release projects and manage SPK",
    implies: ["production.view", "production.report", "production.handover", "production.dispatch"],
  },
] as const satisfies readonly PermissionDef[];
