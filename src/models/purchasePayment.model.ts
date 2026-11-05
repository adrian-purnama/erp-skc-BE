import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

/** Who is paid on the PO: `vendor` = the PO's vendor; `reimburse` = a staff member, for their Nota Realisasi. */
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

/** Statuses that hold an amount against what the PO owes its payee. */
export const PURCHASE_PAYMENT_LIVE_STATUSES: PurchasePaymentStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "paid",
];

/** `partial`: part of what is owed; `full`: everything left for the payee at that moment. */
export const PURCHASE_PAYMENT_STAGES = ["partial", "full"] as const;
export type PurchasePaymentStage = (typeof PURCHASE_PAYMENT_STAGES)[number];

export const PURCHASE_PAYMENT_METHODS = ["transfer", "cash", "other"] as const;
export type PurchasePaymentMethod = (typeof PURCHASE_PAYMENT_METHODS)[number];

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
 * Money going out on one PO, to one payee: the PO's vendor, or a staff member
 * paid back for their posted Nota Realisasi. Partial or full; approved by the
 * PO's approvers, then paid by finance with proof. It may name the vendor
 * invoices (vendor) or NR (reimburse) it pays for.
 */
export interface PurchasePaymentInterface extends PaymentApproval {
  number: string;
  kind: PurchasePaymentKind;
  status: PurchasePaymentStatus;
  purchaseOrderId: Types.ObjectId;
  /** The PO's vendor (both kinds, for display). */
  vendorId?: Types.ObjectId | null;
  stage: PurchasePaymentStage;
  /** Partial: percent of what the payee is owed, or a fixed amount; null for full. */
  basis?: "percent" | "fixed" | null;
  rate?: string | null;
  /** Reimburse: the payee's NR this pays back, if named. */
  realizationIds: Types.ObjectId[];
  /** Vendor: the posted vendor invoices this pays, if named. */
  invoiceIds: Types.ObjectId[];
  /** Reimbursements: the staff member paid back. */
  payeeUserId?: Types.ObjectId | null;
  payeeName: string;
  /** Integer rupiah to pay. */
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
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder", required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", default: null },
    stage: { type: String, enum: PURCHASE_PAYMENT_STAGES, required: true },
    basis: { type: String, enum: ["percent", "fixed", null], default: null },
    rate: { type: String, trim: true, default: null },
    realizationIds: { type: [Schema.Types.ObjectId], default: [] },
    invoiceIds: { type: [Schema.Types.ObjectId], default: [] },
    payeeUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    payeeName: { type: String, trim: true, default: "" },
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

purchasePaymentSchema.index({ realizationIds: 1 });
purchasePaymentSchema.index({ invoiceIds: 1 });
purchasePaymentSchema.index({ kind: 1, status: 1, createdAt: -1 });

export const PurchasePaymentRepo = auditedModel<PurchasePaymentInterface>(
  "PurchasePayment",
  purchasePaymentSchema,
);
