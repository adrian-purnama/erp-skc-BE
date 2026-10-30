import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";
import { purchaseChargeSchema, type PurchaseCharge } from "./purchaseCharge.model";

/** Approval flow; arrival and actual cost are tracked on realizations. */
export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/**
 * Statuses whose lines hold qty against their SPP lines. A rejected PO frees
 * its qty at once; revising it back to draft checks the lines again on submit.
 */
export const PURCHASE_ORDER_LIVE_STATUSES: PurchaseOrderStatus[] = [
  "draft",
  "pending_approval",
  "approved",
];

/**
 * POs whose lines hold qty: live ones, plus cancelled ones that were partly
 * received (they keep `closedQty`, the received part).
 */
export const PURCHASE_ORDER_HOLDING_QUERY = {
  $or: [
    { status: { $in: PURCHASE_ORDER_LIVE_STATUSES } },
    { status: "cancelled", closedPartial: true },
  ],
};

/** Qty a line still holds: all of it while live, the received part once cancelled. */
export function heldLineQty(
  status: PurchaseOrderStatus,
  line: { qty: string; closedQty?: string | null },
): string {
  return status === "cancelled" ? (line.closedQty ?? "0") : line.qty;
}

export type PurchaseOrderLine = {
  _id?: Types.ObjectId;
  requestId: Types.ObjectId;
  /** `_id` of the line inside the SPP. */
  requestLineId: Types.ObjectId;
  /** Copied from the SPP so cost rolls up per project / SPK / RAB without a join. */
  projectId?: Types.ObjectId | null;
  productionOrderId?: Types.ObjectId | null;
  purchaseRabId?: Types.ObjectId | null;
  materialItemId: Types.ObjectId;
  itemUomId: Types.ObjectId;
  qty: string;
  /** Integer rupiah per unit. */
  unitPrice: string;
  note: string;
  /** Set when the PO was cancelled after part of it arrived: the qty received. */
  closedQty?: string | null;
};

/** Approval step a pending PO waits on: 1 first, then 2. */
export type PurchaseOrderApprovalLevel = 1 | 2;

/**
 * Legacy: quotation files embedded on the PO. Versions now live in
 * PurchaseOrderQuotation; these are moved there the first time a PO is read.
 */
export type PurchaseOrderQuotation = {
  _id?: Types.ObjectId;
  gridFsId: Types.ObjectId;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: Types.ObjectId | null;
  uploadedAt: Date;
};

/**
 * Pengajuan Pembelian / PO: one vendor, lines of exactly one SPP, needs
 * approval by the two approvers picked on it, level 1 then level 2. An SPP
 * may be split over several POs (one per vendor).
 */
export interface PurchaseOrderInterface {
  number: string;
  requestId: Types.ObjectId;
  vendorId: Types.ObjectId;
  termOfPaymentId?: Types.ObjectId | null;
  status: PurchaseOrderStatus;
  /** YYYY-MM-DD delivery date asked from the vendor, or null. */
  expectedDate?: string | null;
  notes: string;
  lines: PurchaseOrderLine[];
  /** Σ qty × unitPrice, integer rupiah. */
  total: string;
  createdBy?: Types.ObjectId;
  /** Picked on the PO; changeable only while draft. */
  approver1Id?: Types.ObjectId | null;
  approver2Id?: Types.ObjectId | null;
  /** Pending POs only: the level whose approver acts next. */
  approvalLevel?: PurchaseOrderApprovalLevel | null;
  quotations: PurchaseOrderQuotation[];
  /** Estimated tax / delivery / other costs on top of the goods; empty = not estimated. */
  estimatedCharges?: PurchaseCharge[];
  /** Legacy: one amount per category, read as fixed charges until saved again. */
  estimates?: {
    tax?: string | null;
    delivery?: string | null;
    other?: string | null;
  } | null;
  submittedAt?: Date | null;
  submittedBy?: Types.ObjectId | null;
  /** Level 1 approval; level 2 is approvedAt / approvedBy below. */
  approved1At?: Date | null;
  approved1By?: Types.ObjectId | null;
  approved1ByName?: string;
  approvedAt?: Date | null;
  approvedBy?: Types.ObjectId | null;
  /** Final (level 2) approver's full name at approval, printed on the PO. */
  approvedByName?: string;
  rejectedAt?: Date | null;
  rejectedBy?: Types.ObjectId | null;
  rejectReason?: string;
  cancelledAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancelReason?: string;
  /** Cancelled after part of it arrived: the received part stays, the rest is dropped. */
  closedPartial?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: "PurchaseRequest", required: true },
    requestLineId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    productionOrderId: { type: Schema.Types.ObjectId, ref: "ProductionOrder", default: null },
    purchaseRabId: { type: Schema.Types.ObjectId, ref: "PurchaseRab", default: null },
    materialItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemUomId: { type: Schema.Types.ObjectId, ref: "ItemUom", required: true },
    qty: { type: String, required: true, trim: true },
    unitPrice: { type: String, required: true, trim: true },
    note: { type: String, trim: true, default: "" },
    closedQty: { type: String, default: null },
  },
  { _id: true },
);

const quotationSchema = new Schema(
  {
    gridFsId: { type: Schema.Types.ObjectId, required: true },
    originalFilename: { type: String, required: true, trim: true },
    contentType: { type: String, required: true, trim: true },
    sizeBytes: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    uploadedAt: { type: Date, required: true },
  },
  { _id: true },
);

const purchaseOrderSchema = new Schema<PurchaseOrderInterface>(
  {
    number: { type: String, required: true, unique: true, trim: true },
    requestId: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseRequest",
      required: true,
      index: true,
    },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
    termOfPaymentId: { type: Schema.Types.ObjectId, ref: "TermOfPayment", default: null },
    status: {
      type: String,
      enum: PURCHASE_ORDER_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    expectedDate: { type: String, default: null },
    notes: { type: String, trim: true, default: "" },
    lines: { type: [lineSchema], default: [] },
    total: { type: String, required: true, default: "0" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    approver1Id: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    approver2Id: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    approvalLevel: { type: Number, enum: [1, 2, null], default: null },
    quotations: { type: [quotationSchema], default: [] },
    estimatedCharges: { type: [purchaseChargeSchema], default: [] },
    estimates: {
      type: new Schema(
        {
          tax: { type: String, default: null },
          delivery: { type: String, default: null },
          other: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    submittedAt: { type: Date, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approved1At: { type: Date, default: null },
    approved1By: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approved1ByName: { type: String, trim: true, default: "" },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedByName: { type: String, trim: true, default: "" },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    rejectReason: { type: String, trim: true, default: "" },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, trim: true, default: "" },
    closedPartial: { type: Boolean, default: false },
  },
  { timestamps: true },
);

purchaseOrderSchema.index({ "lines.requestId": 1, status: 1 });
purchaseOrderSchema.index({ status: 1, createdAt: -1 });

export const PurchaseOrderRepo = auditedModel<PurchaseOrderInterface>(
  "PurchaseOrder",
  purchaseOrderSchema,
);
