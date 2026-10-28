import type { ProjectRabUserRefOutDto } from "./projectRab.dto";

export type ProductionOrderTypeDto = "inhouse" | "subcon" | "outsource";
export type ProductionOrderStatusDto =
  | "draft"
  | "released"
  | "in_progress"
  | "completed"
  | "cancelled";

export type ProductionReadinessCheckKey = "quotation" | "rab" | "items";

export type ProductionReadinessCheckOutDto = {
  key: ProductionReadinessCheckKey;
  label: string;
  ok: boolean;
  detail: string;
};

/** One shop drawing item and which pieces it still needs before production. */
export type ProductionReadinessItemOutDto = {
  itemId: string;
  code: string;
  name: string;
  label: string;
  shopDrawing: boolean;
  boq: boolean;
  /** BOQ make qty; null when there is no BOQ. */
  makeQty: string | null;
  productionFile: boolean;
  ready: boolean;
};

export type ProductionReadinessOutDto = {
  projectId: string;
  ready: boolean;
  releasedAt: string | null;
  releasedBy: ProjectRabUserRefOutDto | null;
  checks: ProductionReadinessCheckOutDto[];
  items: ProductionReadinessItemOutDto[];
  readyCount: number;
  totalCount: number;
};

export type ProductionItemProgressStatusDto =
  | "not_started"
  | "partial"
  | "in_progress"
  | "done";

/** Per shop drawing item: planned vs ordered (SPK) vs finished. */
export type ProductionItemProgressOutDto = {
  itemId: string;
  code: string;
  name: string;
  label: string;
  category: string | null;
  makeQty: string;
  /** Qty held by SPKs (completed SPKs count their finished qty). */
  orderedQty: string;
  doneQty: string;
  /** makeQty − orderedQty, never below 0. */
  remainingToOrder: string;
  /** doneQty / makeQty × 100, 0–100. */
  percent: number;
  status: ProductionItemProgressStatusDto;
  orderCount: number;
};

export type ProductionProjectProgressOutDto = {
  projectId: string;
  releasedAt: string | null;
  items: ProductionItemProgressOutDto[];
  totals: { makeQty: string; doneQty: string; percent: number };
};

export type ProductionOrderMaterialOutDto = {
  materialItemId: string;
  materialCode: string;
  materialName: string;
  itemUomId: string;
  uomSymbol: string;
  qtyPerUnit: string;
  qty: string;
};

export type ProductionOrderSummaryOutDto = {
  id: string;
  number: string;
  type: ProductionOrderTypeDto;
  status: ProductionOrderStatusDto;
  projectId: string;
  projectNumber: string;
  projectName: string;
  shopDrawingItemId: string;
  itemLabel: string;
  qty: string;
  doneQty: string;
  plannedStart: string | null;
  plannedFinish: string | null;
  picUserId: string | null;
  pic: string;
  createdAt: string | null;
  releasedAt: string | null;
  completedAt: string | null;
};

export type ProductionReportOutDto = {
  id: string;
  productionOrderId: string;
  qtyDone: string;
  reportDate: string;
  notes: string;
  reportedBy: ProjectRabUserRefOutDto | null;
  createdAt: string | null;
  isVoided: boolean;
  voidedAt: string | null;
  voidedBy: ProjectRabUserRefOutDto | null;
  voidReason: string;
};

export type ProductionOrderFileRefOutDto = {
  fileId: string;
  version: number;
  originalFilename: string;
};

export type ProductionOrderOutDto = ProductionOrderSummaryOutDto & {
  notes: string;
  createdBy: ProjectRabUserRefOutDto | null;
  releasedBy: ProjectRabUserRefOutDto | null;
  /** Issuer full name printed under "Dikeluarkan oleh". */
  releasedByName: string;
  completedBy: ProjectRabUserRefOutDto | null;
  completeNote: string;
  cancelledAt: string | null;
  cancelledBy: ProjectRabUserRefOutDto | null;
  cancelReason: string;
  /** Snapshot (released) or live preview from the current BOQ (draft). */
  makeQty: string;
  materials: ProductionOrderMaterialOutDto[];
  shopDrawingFile: ProductionOrderFileRefOutDto | null;
  productionFile: ProductionOrderFileRefOutDto | null;
  /** Largest qty this SPK may hold right now (draft edit / create). */
  maxQty: string;
  reports: ProductionReportOutDto[];
};

export type CreateProductionOrderInDto = {
  projectId: string;
  shopDrawingItemId: string;
  qty: string;
  plannedStart: string | null;
  plannedFinish: string | null;
  /** User id of the person in charge, or null for none. */
  picUserId: string | null;
  notes: string;
};

export type UpdateProductionOrderInDto = {
  qty?: string;
  plannedStart?: string | null;
  plannedFinish?: string | null;
  picUserId?: string | null;
  notes?: string;
};

/** A user that can be picked as SPK person in charge. */
export type ProductionPicUserOutDto = {
  id: string;
  name: string;
  email: string;
};

export type CompleteProductionOrderInDto = { note: string };
export type CancelProductionOrderInDto = { reason: string };

export type CreateProductionReportInDto = {
  qtyDone: string;
  reportDate: string;
  notes: string;
};

export type VoidProductionReportInDto = { reason: string };
