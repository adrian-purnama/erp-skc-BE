import type { PermissionDef } from "../admin/admin.permissions";

export const QUOTATION_PERMS = [
  { key: "quotation.view", label: "View quotations" },
  {
    key: "quotation.manage",
    label: "Manage quotation drafts (create, edit prices, resync, discard)",
    implies: ["quotation.view"],
  },
  {
    key: "quotation.issue",
    label: "Issue and re-issue quotations",
    implies: ["quotation.view"],
  },
  {
    key: "quotation.won",
    label: "Mark a quotation as won and undo won",
    implies: ["quotation.view"],
  },
] as const satisfies readonly PermissionDef[];
