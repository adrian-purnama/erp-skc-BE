export type PermissionDef = {
  key: string;
  label: string;
  implies?: readonly string[];
  manual?: boolean;
};

export const ADMIN_PERMS = [
  { key: "admin.config.view", label: "View app config" },
  {
    key: "admin.config.manage",
    label: "Manage app config",
    implies: ["admin.config.view"],
  },
  { key: "admin.user.view", label: "View users" },
  {
    key: "admin.user.manage",
    label: "Manage users",
    implies: ["admin.user.view"],
  },
  { key: "admin.role.view", label: "View roles" },
  {
    key: "admin.role.manage",
    label: "Manage roles",
    implies: ["admin.role.view"],
  },
  { key: "admin.audit.view", label: "View audit log" },
] as const satisfies readonly PermissionDef[];
