import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

/** `vendor`: a stage of paying a PO's vendor; `reimburse`: paying staff back for their notas. */
export const PURCHASE_PAYMENT_KINDS = ["vendor", "reimburse"] as const;
export type PurchasePaymentKind = (typeof PURCHASE_PAYMENT_KINDS)[number];

export const PURCHASE_PAYMENT_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "paid",
  "rejected",
  "cancelled",
] as const;
export type PurchasePaymentStatus = (typeof PURCHASE_PAYMENT_STATUSES)[number];

/** Statuses that hold an amount against the PO (or a nota against reimbursement). */
export const PURCHASE_PAYMENT_LIVE_STATUSES: PurchasePaymentStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "paid",
];

/** DP (down payment), termin (progress payment), pelunasan (final settlement). */
export const PURCHASE_PAYMENT_STAGES = ["dp", "termin", "pelunasan"] as const;
export type PurchasePaymentStage = (typeof PURCHASE_PAYMENT_STAGES)[number];

export const PURCHASE_PAYMENT_METHODS = ["transfer", "cash", "other"] as const;
export type PurchasePaymentMethod = (typeof PURCHASE_PAYMENT_METHODS)[number];

export const REIMBURSE_ITEM_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReimburseItemStatus = (typeof REIMBURSE_ITEM_STATUSES)[number];

/** Level 1 → level 2 sign-off, by the approvers copied from the PO at submit. */
export type PaymentApproval = {
  approver1Id?: Types.ObjectId | null;
  approver2Id?: Types.ObjectId | null;
  /** While waiting: the level whose approver acts next. */
  approvalLevel?: 1 | 2 | null;
  approved1At?: Date | null;
  approved1By?: Types.ObjectId | null;
  approved1ByName?: string;
  approvedAt?: Date | null;
  approvedBy?: Types.ObjectId | null;
  approvedByName?: string;
  rejectedAt?: Date | null;
  rejectedBy?: Types.ObjectId | null;
  rejectReason?: string;
};

/** One staff nota in a reimbursement, approved by its own PO's approvers. */
export type ReimburseItem = PaymentApproval & {
  _id?: Types.ObjectId;
  realizationId: Types.ObjectId;
  purchaseOrderId: Types.ObjectId;
  /** The nota total (goods + charges) at the time it was added, integer rupiah. */
  amount: string;
  status: ReimburseItemStatus;
};

/** Transfer slip / receipt, in the `purchasing` GridFS bucket. */
export type PaymentProof = {
  _id?: Types.ObjectId;
  gridFsId: Types.ObjectId;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: Types.ObjectId | null;
  uploadedAt: Date;
};

/**
 * Money going out for purchasing: a vendor payment stage on one PO, or a
 * reimbursement of staff notas. Approved, then paid by finance with proof.
 * Loosely tied to goods received: a stage may name receipts, but only the
 * pelunasan needs the PO fully received.
 */
export interface PurchasePaymentInterface extends PaymentApproval {
  number: string;
  kind: PurchasePaymentKind;
  status: PurchasePaymentStatus;
  /** Vendor payments. */
  purchaseOrderId?: Types.ObjectId | null;
  vendorId?: Types.ObjectId | null;
  stage?: PurchasePaymentStage | null;
  /** Percent of the PO payable, or a fixed amount; null for pelunasan and reimbursements. */
  basis?: "percent" | "fixed" | null;
  rate?: string | null;
  /** Receipts this stage pays for, if any (informational). */
  realizationIds: Types.ObjectId[];
  /** Reimbursements: the staff member paid back, and their notas. */
  payeeUserId?: Types.ObjectId | null;
  payeeName: string;
  items: ReimburseItem[];
  /** Integer rupiah to pay (reimbursement: the approved notas once decided). */
  amount: string;
  /** YYYY-MM-DD or null. */
  dueDate?: string | null;
  notes: string;
  createdBy?: Types.ObjectId;
  submittedAt?: Date | null;
  submittedBy?: Types.ObjectId | null;
  paidAt?: Date | null;
  paidBy?: Types.ObjectId | null;
  /** YYYY-MM-DD the money went out. */
  paidDate?: string | null;
  method?: PurchasePaymentMethod | null;
  reference: string;
  proofs: PaymentProof[];
  cancelledAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancelReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const approvalFields = {
  approver1Id: { type: Schema.Types.ObjectId, ref: "User", default: null },
  approver2Id: { type: Schema.Types.ObjectId, ref: "User", default: null },
  approvalLevel: { type: Number, enum: [1, 2, null], default: null },
  approved1At: { type: Date, default: null },
  approved1By: { type: Schema.Types.ObjectId, ref: "User", default: null },
  approved1ByName: { type: String, trim: true, default: "" },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  approvedByName: { type: String, trim: true, default: "" },
  rejectedAt: { type: Date, default: null },
  rejectedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  rejectReason: { type: String, trim: true, default: "" },
};

const itemSchema = new Schema(
  {
    ...approvalFields,
    realizationId: { type: Schema.Types.ObjectId, ref: "PurchaseRealization", required: true },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder", required: true },
    amount: { type: String, required: true, trim: true },
    status: { type: String, enum: REIMBURSE_ITEM_STATUSES, required: true, default: "pending" },
  },
  { _id: true },
);

const proofSchema = new Schema(
  {
    gridFsId: { type: Schema.Types.ObjectId, required: true },
    originalFilename: { type: String, required: true, trim: true },
    contentType: { type: String, required: true, trim: true },
    sizeBytes: { type: Number, required: true, min: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    uploadedAt: { type: Date, required: true },
  },
  { _id: true },
);

const purchasePaymentSchema = new Schema<PurchasePaymentInterface>(
  {
    ...approvalFields,
    number: { type: String, required: true, unique: true, trim: true },
    kind: { type: String, enum: PURCHASE_PAYMENT_KINDS, required: true },
    status: {
      type: String,
      enum: PURCHASE_PAYMENT_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder", default: null, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", default: null },
    stage: { type: String, enum: [...PURCHASE_PAYMENT_STAGES, null], default: null },
    basis: { type: String, enum: ["percent", "fixed", null], default: null },
    rate: { type: String, trim: true, default: null },
    realizationIds: { type: [Schema.Types.ObjectId], default: [] },
    payeeUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    payeeName: { type: String, trim: true, default: "" },
    items: { type: [itemSchema], default: [] },
    amount: { type: String, required: true, default: "0" },
    dueDate: { type: String, default: null },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    submittedAt: { type: Date, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    paidAt: { type: Date, default: null },
    paidBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    paidDate: { type: String, default: null },
    method: { type: String, enum: [...PURCHASE_PAYMENT_METHODS, null], default: null },
    reference: { type: String, trim: true, default: "" },
    proofs: { type: [proofSchema], default: [] },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

purchasePaymentSchema.index({ "items.realizationId": 1 });
purchasePaymentSchema.index({ kind: 1, status: 1, createdAt: -1 });

export const PurchasePaymentRepo = auditedModel<PurchasePaymentInterface>(
  "PurchasePayment",
  purchasePaymentSchema,
);
