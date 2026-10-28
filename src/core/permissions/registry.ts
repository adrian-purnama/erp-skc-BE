import {
  ADMIN_PERMS,
  type PermissionDef,
} from "../../modules/admin/admin.permissions";
import { SHRINK_DB_PERMS } from "../../modules/admin/shrinkDb/shrinkDb.permissions";
import { CUSTOMER_PERMS } from "../../modules/customer/customer.permissions";
import { ITEM_MASTER_PERMS } from "../../modules/itemMaster/itemMaster.permissions";
import { PRODUCTION_PERMS } from "../../modules/production/production.permissions";
import { PROJECT_PERMS } from "../../modules/project/project.permissions";
import { PURCHASING_PERMS } from "../../modules/purchasing/purchasing.permissions";
import { QUOTATION_PERMS } from "../../modules/quotation/quotation.permissions";
import { TERM_OF_PAYMENT_PERMS } from "../../modules/termOfPayment/termOfPayment.permissions";
import { UOM_PERMS } from "../../modules/uom/uom.permissions";
import { VENDOR_PERMS } from "../../modules/vendor/vendor.permissions";

const MODULE_PERMS: readonly PermissionDef[] = [
  ...ADMIN_PERMS,
  ...SHRINK_DB_PERMS,
  ...CUSTOMER_PERMS,
  ...ITEM_MASTER_PERMS,
  ...PROJECT_PERMS,
  ...PRODUCTION_PERMS,
  ...PURCHASING_PERMS,
  ...QUOTATION_PERMS,
  ...TERM_OF_PAYMENT_PERMS,
  ...UOM_PERMS,
  ...VENDOR_PERMS,
];

const byKey = new Map<string, PermissionDef>(
  MODULE_PERMS.map((p) => [p.key, p]),
);

export function all(): readonly PermissionDef[] {
  return MODULE_PERMS;
}

export function has(key: string): boolean {
  if (key === "*") return false;
  return byKey.has(key);
}

export function get(key: string): PermissionDef | undefined {
  return byKey.get(key);
}

export function implied(key: string): Set<string> {
  const result = new Set<string>();
  const visit = (k: string) => {
    const entry = byKey.get(k);
    if (!entry?.implies) return;
    for (const child of entry.implies) {
      if (result.has(child)) continue;
      result.add(child);
      visit(child);
    }
  };
  visit(key);
  return result;
}

export function requireLabels(): string[] {
  return MODULE_PERMS.filter((p) => !p.label.trim()).map((p) => p.key);
}
