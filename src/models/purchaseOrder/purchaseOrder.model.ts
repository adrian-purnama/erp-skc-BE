import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

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

export type PurchaseOrderLine = {
  _id?: Types.ObjectId;
  requestId: Types.ObjectId;
  /** `_id` of the line inside the SPP. */
  requestLineId: Types.ObjectId;
  /** Copied from the SPP so cost rolls up per project / SPK without a join. */
  projectId: Types.ObjectId;
  productionOrderId?: Types.ObjectId | null;
  materialItemId: Types.ObjectId;
  itemUomId: Types.ObjectId;
  qty: string;
  /** Integer rupiah per unit. */
  unitPrice: string;
  note: string;
};

/**
 * Pengajuan Pembelian / PO: one vendor, lines of exactly one SPP, needs
 * approval. An SPP may be split over several POs (one per vendor).
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
  submittedAt?: Date | null;
  submittedBy?: Types.ObjectId | null;
  approvedAt?: Date | null;
  approvedBy?: Types.ObjectId | null;
  /** Approver's full name at approval, printed on the PO. */
  approvedByName?: string;
  rejectedAt?: Date | null;
  rejectedBy?: Types.ObjectId | null;
  rejectReason?: string;
  cancelledAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancelReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: "PurchaseRequest", required: true },
    requestLineId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    productionOrderId: { type: Schema.Types.ObjectId, ref: "ProductionOrder", default: null },
    materialItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemUomId: { type: Schema.Types.ObjectId, ref: "ItemUom", required: true },
    qty: { type: String, required: true, trim: true },
    unitPrice: { type: String, required: true, trim: true },
    note: { type: String, trim: true, default: "" },
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
    submittedAt: { type: Date, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedByName: { type: String, trim: true, default: "" },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    rejectReason: { type: String, trim: true, default: "" },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

purchaseOrderSchema.index({ "lines.requestId": 1, status: 1 });
purchaseOrderSchema.index({ status: 1, createdAt: -1 });

export const PurchaseOrderRepo = auditedModel<PurchaseOrderInterface>(
  "PurchaseOrder",
  purchaseOrderSchema,
);
