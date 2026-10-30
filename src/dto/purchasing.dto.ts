import type { ProjectRabUserRefOutDto } from "./projectRab.dto";
import type { ProjectShopDrawingBoqMaterialOutDto } from "./projectShopDrawingBoq.dto";

export type PurchaseRequestStatusDto = "draft" | "submitted" | "cancelled" | "declined";
export type PurchaseRequestLineSourceDto = "spk" | "rab" | "extra";

/** Item Master material with its UOMs, for the extra-item picker. */
export type PurchasingMaterialOutDto = ProjectShopDrawingBoqMaterialOutDto;

/** SPK / RAB vs extra is decided by the server from the SPK or RAB list. */
export type PurchaseRequestLineInDto = {
  materialItemId: string;
  itemUomId: string;
  qty: string;
  note: string;
};

/** Exactly one of productionOrderId / purchaseRabId; only an SPK brings a project. */
export type CreatePurchaseRequestInDto = {
  productionOrderId: string | null;
  purchaseRabId: string | null;
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
  /** From the SPK; null for a Purchasing RAB SPP. */
  projectId: string | null;
  /** Project, or "—" / "No project" for a Purchasing RAB SPP. */
  projectNumber: string;
  projectName: string;
  productionOrderId: string | null;
  productionOrderNumber: string | null;
  purchaseRabId: string | null;
  purchaseRabNumber: string | null;
  purchaseRabTitle: string | null;
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

/** One SPK material / RAB line: planned vs already requested on other live SPPs. */
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
  /** RAB basis only: budget unit price, integer rupiah. */
  unitPrice: string | null;
  /** On live POs for this SPK's / RAB's SPPs. */
  orderedQty: string;
  /** Arrived on posted realizations for this SPK's / RAB's SPPs. */
  receivedQty: string;
};

/** What an SPK or a Purchasing RAB still has to request, to fill an SPP. */
export type PurchaseRequestPlanOutDto = {
  basis: "spk" | "rab";
  productionOrderId: string | null;
  productionOrderNumber: string | null;
  purchaseRabId: string | null;
  purchaseRabNumber: string | null;
  projectId: string | null;
  projectNumber: string | null;
  projectName: string | null;
  /** SPK: shop drawing item; RAB: its title. */
  itemLabel: string;
  plannedStart: string | null;
  /** Keys counted as "on the RAB" for this SPP (project RAB, or the Purchasing RAB). */
  rabKeys: string[];
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

/** A locked Purchasing RAB that an SPP can be made for. */
export type PurchasingRabOptionOutDto = {
  id: string;
  number: string;
  title: string;
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

/** One vendor's past prices for a material×UOM, from approved POs. */
export type VendorPriceOutDto = {
  vendorId: string;
  vendorName: string;
  /** Unit price on that vendor's most recent approved PO, integer rupiah. */
  lastPrice: string;
  lastOrderNumber: string;
  /** Approval date of that PO, ISO. */
  lastDate: string | null;
  /** Lowest unit price this vendor ever had on an approved PO. */
  minPrice: string;
  orderCount: number;
};

/** An SPP line that still has qty to order. */
export type OpenRequestLineOutDto = {
  requestId: string;
  requestNumber: string;
  requestLineId: string;
  neededDate: string;
  projectId: string | null;
  /** Project, or "—" / "No project" for a Purchasing RAB without one. */
  projectNumber: string;
  projectName: string;
  productionOrderNumber: string | null;
  itemLabel: string | null;
  purchaseRabId: string | null;
  /** "Project RAB" or the Purchasing RAB's number · title; null without any RAB. */
  rabLabel: string | null;
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
  /** RAB unit price for this material×UOM (project RAB or Purchasing RAB), integer rupiah. */
  rabUnitPrice: string | null;
  /** RAB purchase qty for this material×UOM; null when not on the RAB. */
  rabQty: string | null;
  /** Ordered for this material×UOM against the same RAB on other live POs. */
  rabOrderedQty: string;
  /** Per vendor, cheapest last price first. */
  priceHistory: VendorPriceOutDto[];
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
  /** Level 1 / level 2 approver; changeable only while draft. */
  approver1Id: string;
  approver2Id: string;
  lines: PurchaseOrderLineInDto[];
};

/** An order line with its own vendor; lines are split into one PO per vendor. */
export type VendorPurchaseOrderLineInDto = PurchaseOrderLineInDto & { vendorId: string };

/** Save lines from one SPP across vendors: one draft PO per vendor. */
export type SavePurchaseOrdersInDto = Omit<
  SavePurchaseOrderInDto,
  "vendorId" | "termOfPaymentId" | "lines"
> & {
  /** Term of payment per vendor; a vendor not listed gets none. */
  terms: Array<{ vendorId: string; termOfPaymentId: string | null }>;
  lines: VendorPurchaseOrderLineInDto[];
  /** Send every resulting PO for approval right after saving. */
  submit: boolean;
};

export type SavePurchaseOrdersOutDto = {
  /** The PO that was edited, or the first one created. */
  order: PurchaseOrderOutDto;
  /** POs made for the other vendors. */
  others: PurchaseOrderSummaryOutDto[];
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
  /** With other live POs this goes past the RAB qty. */
  overRabQty: boolean;
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
  /** Goods only. */
  total: string;
  /** Goods + estimated tax / delivery / other (= total when nothing is estimated). */
  estimatedTotal: string;
  lineCount: number;
  overBudgetCount: number;
  requestId: string;
  requestNumber: string;
  /** Project, or "—" / "No project" for a Purchasing RAB without one. */
  projectNumber: string;
  projectName: string;
  /** The SPP's Purchasing RAB; null for an SPK (project RAB) SPP. */
  purchaseRabId: string | null;
  /** "Project RAB" or the Purchasing RAB's number · title; null without any RAB. */
  rabLabel: string | null;
  expectedDate: string | null;
  createdBy: ProjectRabUserRefOutDto | null;
  createdAt: string | null;
  submittedAt: string | null;
  approver1: ProjectRabUserRefOutDto | null;
  approver2: ProjectRabUserRefOutDto | null;
  /** Pending POs: the level waiting to approve. */
  approvalLevel: 1 | 2 | null;
  approved1At: string | null;
  approvedAt: string | null;
  /** Posted receipts against the PO's lines. */
  receiptStatus: "none" | "partial" | "full";
  /** Vendor payments marked paid, integer rupiah. */
  paidTotal: string;
};

/** One material×UOM on the PO's RAB and/or the PO itself. */
export type PurchaseOrderRabCompareLineOutDto = {
  key: string;
  materialItemId: string;
  materialCode: string;
  materialName: string;
  uomSymbol: string;
  /** Null when the item is not on the RAB. */
  rabQty: string | null;
  rabUnitPrice: string | null;
  rabAmount: string | null;
  /** Qty on other live POs of the same RAB. */
  otherOrderedQty: string;
  /** Null when the item is not on this PO. */
  poQty: string | null;
  poUnitPrice: string | null;
  poAmount: string | null;
  /** Posted realizations of this PO; null when the item is not on this PO. */
  realizedQty: string | null;
  realizedUnitPrice: string | null;
  realizedAmount: string | null;
};

/** A PO beside the RAB it is budgeted on (Purchasing RAB, else project RAB). */
export type PurchaseOrderRabCompareOutDto = {
  orderId: string;
  orderNumber: string;
  status: PurchaseOrderStatusDto;
  vendorName: string;
  projectNumber: string;
  projectName: string;
  /** Null when the SPP has no RAB. */
  rab: {
    label: string;
    purchaseRabId: string | null;
    projectId: string | null;
    status: PurchaseRabStatusDto;
    /** Σ RAB qty × RAB unit price over all RAB lines. */
    total: string;
    /** The RAB's own tax / delivery / other budget (whole RAB). */
    chargesTotal: string;
    chargesByCategory: Record<PurchaseChargeCategoryDto, string>;
  } | null;
  poTotal: string;
  /** Posted realizations: goods only, charges (PPN, ongkir, …), and count. */
  realizedSubtotal: string;
  realizedCharges: string;
  /** Posted charges per category vs the PO's estimates. */
  realizedChargesByCategory: Record<PurchaseChargeCategoryDto, string>;
  estimates: PurchaseChargeAmountsDto;
  realizationCount: number;
  lines: PurchaseOrderRabCompareLineOutDto[];
};

/** One version of the vendor quotation on a PO (versioned like project documents). */
export type PurchaseOrderQuotationOutDto = {
  id: string;
  version: number;
  isCurrent: boolean;
  isDeleted: boolean;
  /** Earlier version with identical content, unless uploaded as forced different. */
  sameAsVersion: number | null;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string | null;
  uploadedByName: string | null;
  deletedAt: string | null;
  deletedByName: string | null;
};

export type PurchaseOrderQuotationsOutDto = {
  current: PurchaseOrderQuotationOutDto | null;
  /** Newest first, deleted ones included. */
  versions: PurchaseOrderQuotationOutDto[];
};

export type PurchaseOrderOutDto = PurchaseOrderSummaryOutDto & {
  termOfPaymentId: string | null;
  termOfPayment: string;
  notes: string;
  lines: PurchaseOrderLineOutDto[];
  /** RAB budget for the same lines (Σ qty × RAB price, where priced). */
  rabTotal: string;
  submittedBy: ProjectRabUserRefOutDto | null;
  approved1By: ProjectRabUserRefOutDto | null;
  approvedBy: ProjectRabUserRefOutDto | null;
  quotation: PurchaseOrderQuotationsOutDto;
  /** Estimated tax / delivery / other rows; percents follow the goods total. */
  estimatedCharges: RealizationChargeOutDto[];
  /** Estimates per category (null = nothing estimated there). */
  estimates: PurchaseChargeAmountsDto;
  /** Goods total + estimates. */
  estimatedTotal: string;
  rejectedAt: string | null;
  rejectedBy: ProjectRabUserRefOutDto | null;
  rejectReason: string;
  cancelledAt: string | null;
  cancelledBy: ProjectRabUserRefOutDto | null;
  cancelReason: string;
  /** Cancelled after part of it arrived: the received part stays on record. */
  closedPartial: boolean;
  /** The viewer created it (or is super admin), so may edit, send, revise or cancel it. */
  canChange: boolean;
  /** The viewer is the approver the PO is waiting on now. */
  canApprove: boolean;
  /** Approved POs: how far the goods arrived / were bought (posted realizations only). */
  realizationStatus: RealizationProgressDto;
  /** Σ posted realization totals incl. charges, integer rupiah. */
  realizedTotal: string;
  /** Σ posted realization goods subtotals (no charges): compares with `total`. */
  realizedSubtotal: string;
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

export type PurchaseChargeCategoryDto = "tax" | "delivery" | "other";

/** Integer rupiah per spending category; null = not estimated / nothing. */
export type PurchaseChargeAmountsDto = Record<PurchaseChargeCategoryDto, string | null>;

export type RealizationChargeInDto = {
  category: PurchaseChargeCategoryDto;
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
  /** `vendor`: the supplier delivered straight to the subcon SPK's vendor. */
  deliveredTo: "us" | "vendor";
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
  /** The PO's tax / delivery / other estimates, as a guide for the charges. */
  estimates: PurchaseChargeAmountsDto;
  lines: RealizationPoLineOutDto[];
  /** Other drafts on this PO; their qty is already held. */
  drafts: RealizationDraftRefOutDto[];
  /** Subcon SPK material: the vendors it may be delivered straight to; null when not possible. */
  directToVendor: string[] | null;
};

export type RealizationDraftRefOutDto = { id: string; number: string };

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
  deliveredTo: "us" | "vendor";
  /** Staff notas: the reimbursement paying it back, if any. */
  reimbursement: { id: string; number: string; status: PurchasePaymentStatusDto } | null;
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
  /** Drafts not posted yet on this PO. */
  drafts: RealizationDraftRefOutDto[];
  /** Posted + draft qty already cover the whole PO: only the drafts are left to post. */
  heldByDrafts: boolean;
};

export type PurchasingUserOutDto = { id: string; name: string; email: string };

// ---- Purchasing RAB (budget outside the BOQ) ----

export type PurchaseRabStatusDto = "draft" | "locked";

export type PurchaseRabLineInDto = {
  materialItemId: string;
  itemUomId: string;
  qty: string;
  /** Integer rupiah per unit. */
  unitPrice: string;
  note: string;
};

/** Draft create / edit: replaces title, notes and every line. */
export type SavePurchaseRabInDto = {
  title: string;
  notes: string;
  lines: PurchaseRabLineInDto[];
  /** Budgeted tax / delivery / other on top of the lines. */
  charges: RealizationChargeInDto[];
};

export type PurchaseRabSummaryOutDto = {
  id: string;
  number: string;
  title: string;
  status: PurchaseRabStatusDto;
  lineCount: number;
  /** Σ qty × unit price, integer rupiah. */
  total: string;
  createdBy: ProjectRabUserRefOutDto | null;
  createdAt: string | null;
  lockedAt: string | null;
};

export type PurchaseRabLineOutDto = {
  key: string;
  materialItemId: string;
  materialCode: string;
  materialName: string;
  itemUomId: string;
  uomSymbol: string;
  qty: string;
  unitPrice: string;
  amount: string;
  note: string;
  /** On live SPPs made for this RAB. */
  requestedQty: string;
  /** On live POs for those SPPs. */
  orderedQty: string;
};

export type PurchaseRabOutDto = PurchaseRabSummaryOutDto & {
  notes: string;
  lines: PurchaseRabLineOutDto[];
  /** Budgeted tax / delivery / other; percents follow the lines total. */
  charges: RealizationChargeOutDto[];
  chargesTotal: string;
  /** Lines total + charges. */
  grandTotal: string;
  lockedBy: ProjectRabUserRefOutDto | null;
  /** SPPs made for this RAB (any status). */
  requests: Array<{ id: string; number: string; status: PurchaseRequestStatusDto }>;
  /** Locked and no live SPP uses it, so it may go back to draft. */
  canUnlock: boolean;
};

// ---- Payments (vendor stages, staff reimbursements) ----

export type PurchasePaymentKindDto = "vendor" | "reimburse";
export type PurchasePaymentStatusDto =
  | "draft"
  | "pending_approval"
  | "approved"
  | "paid"
  | "rejected"
  | "cancelled";
export type PurchasePaymentStageDto = "dp" | "termin" | "pelunasan";
export type PurchasePaymentMethodDto = "transfer" | "cash" | "other";

/** Level 1 → level 2 sign-off; `awaitingUserId` is who acts next. */
export type PaymentApprovalOutDto = {
  approver1: ProjectRabUserRefOutDto | null;
  approver2: ProjectRabUserRefOutDto | null;
  approvalLevel: 1 | 2 | null;
  awaitingUserId: string | null;
  /** The signed-in user is the approver this waits on now. */
  viewerCanApprove: boolean;
  approved1By: ProjectRabUserRefOutDto | null;
  approved1At: string | null;
  approvedBy: ProjectRabUserRefOutDto | null;
  approvedAt: string | null;
  rejectedBy: ProjectRabUserRefOutDto | null;
  rejectedAt: string | null;
  rejectReason: string;
};

/** One staff nota in a reimbursement. */
export type ReimburseItemOutDto = PaymentApprovalOutDto & {
  id: string;
  realizationId: string;
  realizationNumber: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  purchaseDate: string;
  place: string;
  amount: string;
  status: "pending" | "approved" | "rejected";
};

export type PaymentProofOutDto = {
  id: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
};

export type PurchasePaymentOutDto = PaymentApprovalOutDto & {
  /** The signed-in user made this request (may edit, send, cancel). */
  viewerIsOwner: boolean;
  id: string;
  number: string;
  kind: PurchasePaymentKindDto;
  status: PurchasePaymentStatusDto;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  vendorName: string | null;
  stage: PurchasePaymentStageDto | null;
  basis: "percent" | "fixed" | null;
  rate: string | null;
  /** Receipts a vendor stage pays for, if named. */
  realizations: Array<{ id: string; number: string; purchaseDate: string; total: string }>;
  payeeUserId: string | null;
  payeeName: string;
  items: ReimburseItemOutDto[];
  /** Integer rupiah (reimbursement: the approved notas once decided, else all of them). */
  amount: string;
  dueDate: string | null;
  notes: string;
  createdBy: ProjectRabUserRefOutDto | null;
  createdAt: string | null;
  submittedAt: string | null;
  paidAt: string | null;
  paidBy: ProjectRabUserRefOutDto | null;
  paidDate: string | null;
  method: PurchasePaymentMethodDto | null;
  reference: string;
  proofs: PaymentProofOutDto[];
  cancelledAt: string | null;
  cancelledBy: ProjectRabUserRefOutDto | null;
  cancelReason: string;
};

/** A PO's vendor payments and what is left to pay. */
export type PurchaseOrderPaymentsOutDto = {
  purchaseOrderId: string;
  /** What the vendor is owed in all (estimate until fully received, then actual). */
  payable: string;
  /** The payable is the actual received amount (pelunasan possible). */
  final: boolean;
  /** Σ live stages (draft → paid). */
  scheduledTotal: string;
  paidTotal: string;
  /** payable − scheduled, never below 0. */
  remaining: string;
  /** Bought by staff on this PO: paid by reimbursement, not to the vendor. */
  staffRealizedTotal: string;
  payments: PurchasePaymentOutDto[];
};

/** Slim row for the Finance → Payments PO picker (still owes the vendor). */
export type PayablePurchaseOrderOutDto = {
  id: string;
  number: string;
  vendorName: string;
  payable: string;
  remaining: string;
  /** Fully received or closed-partial: pelunasan allowed. */
  final: boolean;
};

/** A posted staff nota not yet in a live reimbursement. */
export type ReimbursableNotaOutDto = {
  realizationId: string;
  number: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  purchaseDate: string;
  place: string;
  total: string;
};

export type SaveVendorPaymentInDto = {
  purchaseOrderId: string;
  stage: PurchasePaymentStageDto;
  /** Null for pelunasan (it settles the rest). */
  basis: "percent" | "fixed" | null;
  rate: string | null;
  amount: string;
  dueDate: string | null;
  notes: string;
  realizationIds: string[];
};

export type SaveReimbursementInDto = {
  payeeUserId: string;
  realizationIds: string[];
  dueDate: string | null;
  notes: string;
};

export type PayPurchasePaymentInDto = {
  paidDate: string;
  method: PurchasePaymentMethodDto;
  reference: string;
};

// ---- Purchase flow (related documents around one document) ----

export type PurchaseFlowKindDto = "request" | "order" | "realization" | "payment" | "spk";

/** SPP → PO → receipts → payments around one document, related ones only. */
export type PurchaseFlowOutDto = {
  focus: { kind: PurchaseFlowKindDto; id: string };
  spks: Array<{ id: string; number: string; type: "inhouse" | "subcon" | "outsource"; status: string }>;
  purchaseRabs: Array<{ id: string; number: string }>;
  requests: Array<{ id: string; number: string; status: PurchaseRequestStatusDto }>;
  orders: Array<{
    id: string;
    number: string;
    status: PurchaseOrderStatusDto;
    closedPartial: boolean;
    approvalLevel: 1 | 2 | null;
    vendorName: string;
    total: string;
    estimatedTotal: string;
    /** Has a labour line: a subcon / outsource vendor fee PO. */
    vendorFee: boolean;
    receipt: "none" | "partial" | "full";
    receivedSubtotal: string;
    /** Approved POs: what the vendor is owed and what is paid. */
    payable: string | null;
    paid: string | null;
  }>;
  realizations: Array<{
    id: string;
    number: string;
    status: PurchaseRealizationStatusDto;
    method: PurchaseRealizationMethodDto;
    purchaseOrderId: string;
    total: string;
    deliveredTo: "us" | "vendor";
  }>;
  payments: Array<{
    id: string;
    number: string;
    kind: PurchasePaymentKindDto;
    status: PurchasePaymentStatusDto;
    stage: PurchasePaymentStageDto | null;
    amount: string;
    purchaseOrderId: string | null;
    payeeName: string;
  }>;
  totals: {
    /** Σ live PO totals (goods). */
    ordered: string;
    /** Σ posted receipt goods. */
    receivedGoods: string;
    /** Vendor payable plus what staff paid themselves. */
    owed: string;
    /** Vendor payments paid plus reimbursed notas. */
    paid: string;
    /** Posted staff notas (paid back by reimbursement) and what of that is reimbursed. */
    staffBought: string;
    reimbursed: string;
  };
};
