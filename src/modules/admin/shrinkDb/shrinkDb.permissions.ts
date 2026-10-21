import type { PermissionDef } from "../admin.permissions";

export const SHRINK_DB_PERMS = [
  { key: "admin.shrinkDb.run", label: "Run Shrink DB" },
] as const satisfies readonly PermissionDef[];
