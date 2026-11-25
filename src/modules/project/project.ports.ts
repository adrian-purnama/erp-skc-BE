import type Decimal from "decimal.js";
import type { Types } from "mongoose";
import type {
  ProjectRabLabourExecutor,
  ProjectRabLabourRole,
  ProjectRabLine,
} from "../../models/projectRab.model";

/**
 * What the project module needs from modules above it (ADR-0001, rule 5).
 * Project declares these ports; production, quotation and purchasing implement
 * them, and `src/index.ts` plugs the implementations in at startup. Project
 * never imports those modules, so the dependency graph stays acyclic.
 */

// ── Production ──────────────────────────────────────────────────────────────

/** One RAB labour line that live SPKs are on, with the qty they hold. */
export type HeldLabourLine = {
  /** RAB line key `${shopDrawingItemId}:${labourItemId}:${labourUomId}`. */
  key: string;
  shopDrawingItemId: string;
  labourName: string;
  role: ProjectRabLabourRole;
  executor: ProjectRabLabourExecutor;
  /** Qty the line's SPKs hold against makeQty. */
  heldQty: string;
};

/** Actual progress inputs for the S-curve. */
export type ScheduleActuals = {
  /** Make qty frozen on SPKs, per shop drawing item (the last SPK with one wins). */
  makeQtyByItem: Map<string, string>;
  /** Valid reports mapped to their RAB line, in report order. */
  reports: Array<{ itemId: string; lineKey: string; date: string; qty: string }>;
};

/** Production figures for a project's list summary. */
export type ProductionSummaryInputs = {
  orders: Array<{ qty: string; plannedFinish: string | null }>;
  reportQtys: string[];
  /** The Production page's weighted %, or null when it has no SPKs / could not be read. */
  productionPercent: number | null;
};

export type ProductionForProject = {
  heldLabourLines(projectId: string): Promise<HeldLabourLine[]>;
  assertProcessKept(
    projectId: string,
    before: ProjectRabLine[],
    after: ProjectRabLine[],
    removedItemIds: string[],
  ): Promise<void>;
  heldQtyOnItem(itemId: Types.ObjectId): Promise<Decimal>;
  countLiveOrdersForShopDrawingItem(itemId: string): Promise<number>;
  scheduleActuals(projectId: string): Promise<ScheduleActuals>;
  summaryInputs(projectIds: string[]): Promise<Map<string, ProductionSummaryInputs>>;
};

// ── Quotation ───────────────────────────────────────────────────────────────

/** A won or issued quotation with its money already computed by quotation. */
export type ContractQuotationFigures = {
  projectId: string;
  status: string;
  revision: number;
  /** Total before tax (after discount and non-tax charges). */
  taxBase: string;
  grandTotal: string;
};

export type QuotationForProject = {
  hasWonQuotation(projectId: string): Promise<boolean>;
  contractQuotations(projectIds: string[]): Promise<ContractQuotationFigures[]>;
};

// ── Purchasing ──────────────────────────────────────────────────────────────

export type PurchasingForProject = {
  /** Posted realization cost split across projects (charges follow their lines). */
  realizedCosts(projectIds: string[]): Promise<Array<{ projectId: string; amount: string }>>;
};

// ── Wiring ──────────────────────────────────────────────────────────────────

type Ports = {
  production: ProductionForProject;
  quotation: QuotationForProject;
  purchasing: PurchasingForProject;
};

let ports: Ports | null = null;

/** Called once at startup by the composition root (and by tests with fakes). */
export function provideProjectPorts(impl: Ports): void {
  ports = impl;
}

function wired(): Ports {
  if (!ports) throw new Error("project ports are not wired: call provideProjectPorts at startup");
  return ports;
}

export const productionPort = (): ProductionForProject => wired().production;
export const quotationPort = (): QuotationForProject => wired().quotation;
export const purchasingPort = (): PurchasingForProject => wired().purchasing;
