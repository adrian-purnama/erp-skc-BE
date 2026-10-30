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
  makeType: ProductionOrderTypeDto;
  shopDrawing: boolean;
  boq: boolean;
  /** BOQ make qty; null when there is no BOQ. */
  makeQty: string | null;
  productionFile: boolean;
  /** False for outsource: the vendor brings its own production files. */
  productionFileRequired: boolean;
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
  /** Need before rounding (qtyPerUnit × SPK qty). */
  exactQty: string;
  /** To request / issue, rounded like the RAB. */
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
  /** Finished pcs (last labour stage, or legacy Σ qtyDone). */
  doneQty: string;
  /**
   * Weighted labour progress 0–100 when the SPK has frozen stages;
   * otherwise same as doneQty/qty percent.
   */
  progressPercent: number;
  plannedStart: string | null;
  plannedFinish: string | null;
  picUserId: string | null;
  pic: string;
  createdAt: string | null;
  releasedAt: string | null;
  completedAt: string | null;
};

export type ProductionLabourStageOutDto = {
  sequence: number;
  name: string;
  weightPercent: number;
  materialItemId: string;
  itemUomId: string;
  /** Pcs reported through this stage. */
  qtyDone: string;
};

export type ProductionReportOutDto = {
  id: string;
  productionOrderId: string;
  /** Set when a vendor handover created this report; void the handover instead. */
  handoverId: string | null;
  qtyDone: string;
  /** Inhouse staged report; null on legacy / vendor reports. */
  stageSequence: number | null;
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
  /** Subcon / outsource: vendor handovers, newest first (empty for inhouse). */
  handovers: ProductionHandoverOutDto[];
  /** Checklist rows a new handover starts with. */
  defaultHandoverChecklist: string[];
  /** Subcon / outsource: each fee line, how much of it may be received so far and how much is. */
  vendorFees: ProductionVendorFeeOutDto[];
  /** Subcon: each material, how much is at our warehouse, on its way and at the vendor. */
  materialsAtVendor: ProductionMaterialAtVendorOutDto[];
  /** Subcon: Surat Jalan to the vendor, newest first. */
  dispatches: MaterialDispatchOutDto[];
  /** Subcon: where material goes, from the approved fee PO; null until it is approved. */
  dispatchVendor: { vendorName: string; purchaseOrderNumber: string } | null;
  /** POs carrying this SPK's lines; `vendorFee` ones are the subcon / outsource vendor. */
  purchaseOrders: ProductionOrderPurchaseOutDto[];
  /** Inhouse staged SPK: frozen labour stepper (empty when legacy / vendor). */
  labourStages: ProductionLabourStageOutDto[];
};

export type ProductionOrderPurchaseOutDto = {
  id: string;
  number: string;
  vendorName: string;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "cancelled";
  /** Σ of this SPK's lines on the PO, integer rupiah. */
  total: string;
  /** Carries the vendor fee (a labour line): the subcon / outsource vendor's PO. */
  vendorFee: boolean;
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
  /** Required on inhouse SPKs that froze labour stages. */
  stageSequence?: number;
};

export type VoidProductionReportInDto = { reason: string };

export type ProductionHandoverStatusDto = "draft" | "posted" | "voided";

export type ProductionHandoverCheckDto = {
  label: string;
  /** Null until checked. */
  result: "ok" | "not_ok" | null;
  note: string;
};

export type ProductionHandoverPhotoOutDto = {
  id: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
};

/** Serah Terima: units a vendor handed over on an SPK. */
export type ProductionHandoverOutDto = {
  id: string;
  number: string;
  productionOrderId: string;
  status: ProductionHandoverStatusDto;
  handoverDate: string;
  qty: string;
  deliveryNoteNumber: string;
  receivedByUserId: string | null;
  receivedByName: string;
  notes: string;
  checklist: ProductionHandoverCheckDto[];
  photos: ProductionHandoverPhotoOutDto[];
  createdBy: ProjectRabUserRefOutDto | null;
  createdAt: string | null;
  postedAt: string | null;
  postedBy: ProjectRabUserRefOutDto | null;
  voidedAt: string | null;
  voidedBy: ProjectRabUserRefOutDto | null;
  voidReason: string;
};

export type SaveProductionHandoverInDto = {
  handoverDate: string;
  qty: string;
  deliveryNoteNumber: string;
  /** Who took the units in; null for none. */
  receivedByUserId: string | null;
  notes: string;
  checklist: ProductionHandoverCheckDto[];
};

export type VoidProductionHandoverInDto = { reason: string };

/** One vendor fee line on an SPK, received in step with the handovers. */
export type ProductionVendorFeeOutDto = {
  materialItemId: string;
  materialName: string;
  itemUomId: string;
  uomSymbol: string;
  feeQty: string;
  /** feeQty × handed over / SPK qty. */
  receivableQty: string;
  /** On draft and posted realizations. */
  receivedQty: string;
};

/** One subcon SPK material: where it is now. */
export type ProductionMaterialAtVendorOutDto = {
  materialItemId: string;
  materialName: string;
  itemUomId: string;
  uomSymbol: string;
  needQty: string;
  /** Posted receipts at our warehouse. */
  receivedAtUsQty: string;
  /** On dispatches not sent yet (draft, waiting approval, approved). */
  onTheWayQty: string;
  /** At our warehouse and free to send. */
  availableQty: string;
  /** Sent dispatches + receipts delivered straight to the vendor. */
  atVendorQty: string;
};

export type MaterialDispatchStatusDto =
  | "draft"
  | "pending_approval"
  | "approved"
  | "sent"
  | "rejected"
  | "cancelled"
  | "voided";

/** Surat Jalan ke vendor. */
export type MaterialDispatchOutDto = {
  id: string;
  number: string;
  status: MaterialDispatchStatusDto;
  vendorName: string;
  feePurchaseOrderNumber: string;
  dispatchDate: string;
  lines: Array<{
    materialItemId: string;
    materialCode: string;
    materialName: string;
    itemUomId: string;
    uomSymbol: string;
    qty: string;
  }>;
  notes: string;
  receivedByName: string;
  photos: ProductionHandoverPhotoOutDto[];
  createdBy: ProjectRabUserRefOutDto | null;
  createdAt: string | null;
  submittedAt: string | null;
  approvedBy: ProjectRabUserRefOutDto | null;
  approvedAt: string | null;
  rejectedBy: ProjectRabUserRefOutDto | null;
  rejectedAt: string | null;
  rejectReason: string;
  sentBy: ProjectRabUserRefOutDto | null;
  sentAt: string | null;
  cancelledBy: ProjectRabUserRefOutDto | null;
  cancelledAt: string | null;
  cancelReason: string;
  voidedBy: ProjectRabUserRefOutDto | null;
  voidedAt: string | null;
  voidReason: string;
};

export type SaveMaterialDispatchInDto = {
  dispatchDate: string;
  lines: Array<{ materialItemId: string; itemUomId: string; qty: string }>;
  notes: string;
  receivedByName: string;
};
