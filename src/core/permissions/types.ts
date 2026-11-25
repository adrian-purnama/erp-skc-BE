/** A curated permission, declared in a module's `<name>.permissions.ts`. */
export type PermissionDef = {
  key: string;
  label: string;
  implies?: readonly string[];
  manual?: boolean;
};
