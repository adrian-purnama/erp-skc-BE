import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export const PURCHASE_REALIZATION_STATUSES = ["draft", "posted", "voided"] as const;
export type PurchaseRealizationStatus = (typeof PURCHASE_REALIZATION_STATUSES)[number];

/** `vendor`: the vendor delivered / invoiced; `staff`: our staff bought it. */
export const PURCHASE_REALIZATION_METHODS = ["vendor", "staff"] as const;
export type PurchaseRealizationMethod = (typeof PURCHASE_REALIZATION_METHODS)[number];

export type PurchaseRealizationLine = {
  _id?: Types.ObjectId;
  /** `_id` of the line inside the PO. */
  poLineId: Types.ObjectId;
  qty: string;
  /** Actual integer rupiah per unit. */
  unitPrice: string;
  note: string;
};

/** A nota / invoice photo or scan, stored in the `purchasing` GridFS bucket. */
export type PurchaseRealizationPhoto = {
  _id?: Types.ObjectId;
  gridFsId: Types.ObjectId;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: Types.ObjectId | null;
  uploadedAt: Date;
};

/** Nota Realisasi: what was actually bought for an approved PO, with proof. */
export interface PurchaseRealizationInterface {
  number: string;
  purchaseOrderId: Types.ObjectId;
  /** Copied from the PO for roll-ups. */
  requestId: Types.ObjectId;
  status: PurchaseRealizationStatus;
  method: PurchaseRealizationMethod;
  /** Who bought it (staff) or received the invoice (vendor). */
  buyerUserId?: Types.ObjectId | null;
  buyerName: string;
  /** YYYY-MM-DD. */
  purchaseDate: string;
  /** Shop / vendor where it was bought. */
  place: string;
  /** Number printed on the nota / invoice, if any. */
  notaNumber: string;
  comments: string;
  lines: PurchaseRealizationLine[];
  /** Σ qty × unitPrice, integer rupiah. */
  total: string;
  photos: PurchaseRealizationPhoto[];
  createdBy?: Types.ObjectId;
  postedAt?: Date | null;
  postedBy?: Types.ObjectId | null;
  voidedAt?: Date | null;
  voidedBy?: Types.ObjectId | null;
  voidReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema(
  {
    poLineId: { type: Schema.Types.ObjectId, required: true },
    qty: { type: String, required: true, trim: true },
    unitPrice: { type: String, required: true, trim: true },
    note: { type: String, trim: true, default: "" },
  },
  { _id: true },
);

const photoSchema = new Schema(
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

const purchaseRealizationSchema = new Schema<PurchaseRealizationInterface>(
  {
    number: { type: String, required: true, unique: true, trim: true },
    purchaseOrderId: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseOrder",
      required: true,
      index: true,
    },
    requestId: { type: Schema.Types.ObjectId, ref: "PurchaseRequest", required: true },
    status: {
      type: String,
      enum: PURCHASE_REALIZATION_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    method: { type: String, enum: PURCHASE_REALIZATION_METHODS, required: true },
    buyerUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    buyerName: { type: String, trim: true, default: "" },
    purchaseDate: { type: String, required: true, trim: true },
    place: { type: String, trim: true, default: "" },
    notaNumber: { type: String, trim: true, default: "" },
    comments: { type: String, trim: true, default: "" },
    lines: { type: [lineSchema], default: [] },
    total: { type: String, required: true, default: "0" },
    photos: { type: [photoSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    postedAt: { type: Date, default: null },
    postedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

purchaseRealizationSchema.index({ status: 1, createdAt: -1 });

export const PurchaseRealizationRepo = auditedModel<PurchaseRealizationInterface>(
  "PurchaseRealization",
  purchaseRealizationSchema,
);
