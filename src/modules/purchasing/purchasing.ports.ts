import type { Types } from "mongoose";
import type { ProjectRabLabourExecutor } from "../../models/projectRab.model";

/**
 * What purchasing needs from production, the module above it (ADR-0001, rule 5).
 * Purchasing declares this port; production implements it and `src/index.ts`
 * wires it at startup, so purchasing never imports production.
 */

/** SPK status as purchasing sees it (production owns the full list). */
export type SpkStatus = string;

/** The SPK fields purchasing uses, as plain data (never a document). */
export type SpkSnapshot = {
  _id: Types.ObjectId;
  number: string;
  projectId: Types.ObjectId;
  shopDrawingItemId: Types.ObjectId;
  status: SpkStatus;
  plannedStart?: string | null;
  labourName: string;
  executor: ProjectRabLabourExecutor;
  /** What the SPK was released with: the materials to request. */
  snapshot?: {
    materials: Array<{ materialItemId: Types.ObjectId; itemUomId: Types.ObjectId; qty: string }>;
  } | null;
};

export type ProductionForPurchasing = {
  getSpk(id: string): Promise<SpkSnapshot | null>;
  getSpks(ids: readonly string[]): Promise<SpkSnapshot[]>;
  /** SPKs by PIC and/or project in these statuses, by number. */
  listSpks(filter: {
    picUserId?: string;
    projectId?: string;
    statuses: readonly SpkStatus[];
  }): Promise<SpkSnapshot[]>;
  /** Vendors a goods receipt may go straight to, or null when it may not (subcon rules). */
  directToVendorTargets(purchaseOrderId: string): Promise<string[] | null>;
  /** A realization's vendor-fee qty must stay within what was handed over. */
  assertRealizationFeeWithinHandover(input: {
    purchaseOrderId: string;
    lines: Array<{ poLineId: string; qty: string }>;
    exceptRealizationId?: string;
  }): Promise<void>;
};

let impl: ProductionForPurchasing | null = null;

/** Called once at startup by the composition root (and by tests with fakes). */
export function providePurchasingPorts(ports: { production: ProductionForPurchasing }): void {
  impl = ports.production;
}

export function productionPort(): ProductionForPurchasing {
  if (!impl) throw new Error("purchasing ports are not wired: call providePurchasingPorts at startup");
  return impl;
}
