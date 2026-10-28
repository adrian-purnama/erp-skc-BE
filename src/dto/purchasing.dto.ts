import type { ProjectRabUserRefOutDto } from "./projectRab.dto";
import type { ProjectShopDrawingBoqMaterialOutDto } from "./projectShopDrawingBoq.dto";

export type PurchaseRequestStatusDto = "draft" | "submitted" | "cancelled" | "declined";
export type PurchaseRequestLineSourceDto = "spk" | "extra";

/** Item Master material with its UOMs, for the extra-item picker. */
export type PurchasingMaterialOutDto = ProjectShopDrawingBoqMaterialOutDto;

/** SPK vs extra is decided by the server from the SPK material list. */
export type PurchaseRequestLineInDto = {
  materialItemId: string;
  itemUomId: string;
  qty: string;
  note: string;
};

export type CreatePurchaseRequestInDto = {
  projectId: string;
  /** Null for a request of extra items only. */
  productionOrderId: string | null;
  neededDate: string;
  notes: string;
  lines: PurchaseRequestLineInDto[];
};

/** Draft edit: replaces date, notes and every line. */
export type UpdatePurchaseRequestInDto = {
  neededDate: string;
  notes: string;
  lines: PurchaseRequestLineInDto[];
};

export type CancelPurchaseRequestInDto = { reason: string };

export type PurchaseRequestLineOutDto = {
  id: string;
  source: PurchaseRequestLineSourceDto;
  materialItemId: string;
  materialCode: string;
  materialName: string;
  itemUomId: string;
  uomSymbol: string;
  qty: string;
  inRab: boolean;
  overPlan: boolean;
  note: string;
} & PurchaseRequestLineOrderOutDto;

export type PurchaseRequestSummaryOutDto = {
  id: string;
  number: string;
  status: PurchaseRequestStatusDto;
  projectId: string;
  projectNumber: string;
  projectName: string;
  productionOrderId: string | null;
  productionOrderNumber: string | null;
  /** Shop drawing item of the SPK; null without SPK. */
  itemLabel: string | null;
  neededDate: string;
  lineCount: number;
  /** Lines that are extra, over plan or not on the RAB. */
  flaggedCount: number;
  /** Submitted SPPs: how far purchasing has ordered it. */
  orderStatus: RequestLineOrderStatusDto;
  /** How much of the requested material has arrived. */
  receiptStatus: RealizationProgressDto;
  /** When the requester confirmed they received everything. */
  receivedAt: string | null;
  requestedBy: ProjectRabUserRefOutDto | null;
  createdAt: string | null;
  submittedAt: string | null;
};

export type PurchaseRequestOutDto = PurchaseRequestSummaryOutDto & {
  notes: string;
  lines: PurchaseRequestLineOutDto[];
  submittedBy: ProjectRabUserRefOutDto | null;
  cancelledAt: string | null;
  cancelledBy: ProjectRabUserRefOutDto | null;
  cancelReason: string;
  declinedAt: string | null;
  declinedBy: ProjectRabUserRefOutDto | null;
  declineReason: string;
  receivedBy: ProjectRabUserRefOutDto | null;
  /** The viewer made this SPP, all of it arrived and it is not confirmed yet. */
  canConfirmReceived: boolean;
  /** POs made from this SPP (any status). */
  orders: Array<{ id: string; number: string; status: PurchaseOrderStatusDto; vendorName: string; total: string }>;
  /** The viewer may edit, submit, delete or cancel it (requester or purchasing). */
  canChange: boolean;
};

/** One SPK material: planned vs already requested on other live SPPs. */
export type PurchaseRequestPlanRowOutDto = {
  materialItemId: string;
  materialCode: string;
  materialName: string;
  itemUomId: string;
  uomSymbol: string;
  plannedQty: string;
  requestedQty: string;
  remainingQty: string;
  inRab: boolean;
  /** On live POs for this SPK's SPPs. */
  orderedQty: string;
  /** Arrived on posted realizations for this SPK's SPPs. */
  receivedQty: string;
};

/** What an SPK still needs, used to fill a new or edited SPP. */
export type PurchaseRequestPlanOutDto = {
  productionOrderId: string;
  productionOrderNumber: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  itemLabel: string;
  plannedStart: string | null;
  rows: PurchaseRequestPlanRowOutDto[];
};

/** A project released to production (request target). */
export type PurchasingProjectOutDto = {
  id: string;
  projectNumber: string;
  name: string;
};

/** A released / in-progress SPK the viewer is PIC of, for a new SPP. */
export type PurchasingSpkOutDto = {
  id: string;
  number: string;
  itemLabel: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
};

/** What the SPP editor needs about a project. */
export type PurchasingProjectContextOutDto = PurchasingProjectOutDto & {
  /** `${materialItemId}:${itemUomId}` keys on the project RAB. */
  rabKeys: string[];
  /** Released / in-progress SPKs that can take a request. */
  orders: Array<{ id: string; number: string; itemLabel: string }>;
};

// ---- Purchase orders (Pengajuan Pembelian / PO) ----

export type PurchaseOrderStatusDto =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "cancelled";

export type RequestLineOrderStatusDto = "open" | "partial" | "ordered";

/** A vendor or term of payment for the PO pickers. */
export type PurchasingOptionOutDto = { id: string; label: string; detail: string };

/** An SPP line that still has qty to order. */
export type OpenRequestLineOutDto = {
  requestId: string;
  requestNumber: string;
  requestLineId: string;
  neededDate: string;
  projectId: string;
  projectNumber: string;
  projectName: string;
  productionOrderNumber: string | null;
  itemLabel: string | null;
  materialItemId: string;
  materialCode: string;
  materialName: string;
  itemUomId: string;
  uomSymbol: string;
  requestedQty: string;
  orderedQty: string;
  remainingQty: string;
  source: PurchaseRequestLineSourceDto;
  inRab: boolean;
  overPlan: boolean;
  note: string;
  /** RAB unit price for this material×UOM on the project, integer rupiah. */
  rabUnitPrice: string | null;
};

export type PurchaseOrderLineInDto = {
  requestLineId: string;
  qty: string;
  unitPrice: string;
  note: string;
};

export type SavePurchaseOrderInDto = {
  /** The one SPP this PO orders from; fixed after create. */
  requestId: string;
  vendorId: string;
  termOfPaymentId: string | null;
  expectedDate: string | null;
  notes: string;
  lines: PurchaseOrderLineInDto[];
};

export type ReasonInDto = { reason: string };

export type PurchaseOrderLineOutDto = Omit<
  OpenRequestLineOutDto,
  "orderedQty" | "remainingQty"
> & {
  id: string;
  qty: string;
  unitPrice: string;
  amount: string;
  /** Ordered on other live POs for the same SPP line. */
  orderedElsewhereQty: string;
  /** More than the SPP line still needed. */
  overRequest: boolean;
  /** Unit price above the RAB price. */
  overBudget: boolean;
  /** PO line note (the SPP reason stays in `note`). */
  orderNote: string;
  /** Arrived / bought on posted realizations. */
  realizedQty: string;
};

export type PurchaseOrderSummaryOutDto = {
  id: string;
  number: string;
  status: PurchaseOrderStatusDto;
  vendorId: string;
  vendorName: string;
  total: string;
  lineCount: number;
  overBudgetCount: number;
  requestId: string;
  requestNumber: string;
  projectNumber: string;
  projectName: string;
  expectedDate: string | null;
  createdBy: ProjectRabUserRefOutDto | null;
  createdAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
};

export type PurchaseOrderOutDto = PurchaseOrderSummaryOutDto & {
  termOfPaymentId: string | null;
  termOfPayment: string;
  notes: string;
  lines: PurchaseOrderLineOutDto[];
  /** RAB budget for the same lines (Σ qty × RAB price, where priced). */
  rabTotal: string;
  submittedBy: ProjectRabUserRefOutDto | null;
  approvedBy: ProjectRabUserRefOutDto | null;
  rejectedAt: string | null;
  rejectedBy: ProjectRabUserRefOutDto | null;
  rejectReason: string;
  cancelledAt: string | null;
  cancelledBy: ProjectRabUserRefOutDto | null;
  cancelReason: string;
  /** The viewer created it (or is super admin), so may edit, send, revise or cancel it. */
  canChange: boolean;
  /** Approved POs: how far the goods arrived / were bought (posted realizations only). */
  realizationStatus: RealizationProgressDto;
  /** Σ posted realization totals incl. charges, integer rupiah. */
  realizedTotal: string;
  realizations: Array<{
    id: string;
    number: string;
    status: PurchaseRealizationStatusDto;
    method: PurchaseRealizationMethodDto;
    purchaseDate: string;
    total: string;
    difference: string;
  }>;
};

/** Where one SPP line stands in ordering. */
export type PurchaseRequestLineOrderOutDto = {
  orderedQty: string;
  /** Arrived on posted realizations. */
  receivedQty: string;
  orderStatus: RequestLineOrderStatusDto;
  orders: Array<{ id: string; number: string; status: PurchaseOrderStatusDto; qty: string }>;
};

// ---- Realization (vendor: Penerimaan, staff: Nota Realisasi) ----

export type PurchaseRealizationStatusDto = "draft" | "posted" | "voided";
export type PurchaseRealizationMethodDto = "vendor" | "staff";
export type RealizationProgressDto = "none" | "partial" | "full";
export type RealizationChargeKindDto = "percent" | "fixed";

export type RealizationChargeInDto = {
  label: string;
  kind: RealizationChargeKindDto;
  /** Percent of the lines subtotal; required for `percent`. */
  rate: string | null;
  /** Integer rupiah; required for `fixed`, recomputed for `percent`. */
  amount: string;
};

export type RealizationChargeOutDto = RealizationChargeInDto & { id: string };

export type SaveRealizationInDto = {
  purchaseOrderId: string;
  method: PurchaseRealizationMethodDto;
  /** Required for staff purchases. */
  buyerUserId: string | null;
  purchaseDate: string;
  place: string;
  notaNumber: string;
  receivedByUserId: string | null;
  deliveryNoteNumber: string;
  comments: string;
  lines: Array<{ poLineId: string; qty: string; unitPrice: string; note: string }>;
  charges: RealizationChargeInDto[];
};

/** One approved PO line and how much of it is already realized. */
export type RealizationPoLineOutDto = {
  poLineId: string;
  materialCode: string;
  materialName: string;
  uomSymbol: string;
  orderedQty: string;
  approvedPrice: string;
  /** On other live (draft / posted) realizations. */
  realizedQty: string;
  remainingQty: string;
};

export type RealizationPlanOutDto = {
  purchaseOrderId: string;
  poNumber: string;
  vendorName: string;
  requestId: string;
  requestNumber: string;
  projectNumber: string;
  projectName: string;
  approvedTotal: string;
  lines: RealizationPoLineOutDto[];
};

export type RealizationLineOutDto = {
  id: string;
  poLineId: string;
  materialCode: string;
  materialName: string;
  uomSymbol: string;
  qty: string;
  unitPrice: string;
  approvedPrice: string;
  amount: string;
  /** amount − qty × approved price. */
  difference: string;
  note: string;
};

export type RealizationPhotoOutDto = {
  id: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: ProjectRabUserRefOutDto | null;
  uploadedAt: string | null;
};

export type RealizationSummaryOutDto = {
  id: string;
  number: string;
  status: PurchaseRealizationStatusDto;
  method: PurchaseRealizationMethodDto;
  purchaseOrderId: string;
  poNumber: string;
  vendorName: string;
  requestNumber: string;
  projectNumber: string;
  projectName: string;
  buyerName: string;
  receivedByName: string;
  purchaseDate: string;
  place: string;
  deliveryNoteNumber: string;
  /** Σ line amounts. */
  subtotal: string;
  chargesTotal: string;
  /** subtotal + chargesTotal. */
  total: string;
  /** Goods lines only: Σ (actual − approved); charges are not included. */
  difference: string;
  photoCount: number;
  createdBy: ProjectRabUserRefOutDto | null;
  createdAt: string | null;
  postedAt: string | null;
};

export type RealizationOutDto = RealizationSummaryOutDto & {
  buyerUserId: string | null;
  receivedByUserId: string | null;
  notaNumber: string;
  comments: string;
  lines: RealizationLineOutDto[];
  charges: RealizationChargeOutDto[];
  photos: RealizationPhotoOutDto[];
  postedBy: ProjectRabUserRefOutDto | null;
  voidedAt: string | null;
  voidedBy: ProjectRabUserRefOutDto | null;
  voidReason: string;
  /** The viewer recorded it (or is super admin). */
  canChange: boolean;
};

/** An approved PO still waiting for (more) realization. */
export type RealizationQueueRowOutDto = PurchaseOrderSummaryOutDto & {
  realizationStatus: RealizationProgressDto;
  realizedTotal: string;
};

export type PurchasingUserOutDto = { id: string; name: string; email: string };
