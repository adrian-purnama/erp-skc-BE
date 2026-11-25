import type { PermissionDef } from "../../../core/permissions/types";

export const SHRINK_DB_PERMS = [
  { key: "admin.shrinkDb.run", label: "Run Shrink DB" },
] as const satisfies readonly PermissionDef[];
