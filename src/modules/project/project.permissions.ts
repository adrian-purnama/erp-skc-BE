import type { PermissionDef } from "../admin/admin.permissions";

export const PROJECT_PERMS = [
  { key: "project.view", label: "View projects" },
  {
    key: "project.manage",
    label: "Manage projects",
    implies: ["project.view"],
  },
] as const satisfies readonly PermissionDef[];
