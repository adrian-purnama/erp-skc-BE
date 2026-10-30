import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

export const PRODUCTION_HANDOVER_STATUSES = ["draft", "posted", "voided"] as const;
export type ProductionHandoverStatus = (typeof PRODUCTION_HANDOVER_STATUSES)[number];

export const HANDOVER_CHECK_RESULTS = ["ok", "not_ok"] as const;
export type HandoverCheckResult = (typeof HANDOVER_CHECK_RESULTS)[number];

/** One checklist row; `result` is null until it is checked. */
export type ProductionHandoverCheck = {
  label: string;
  result: HandoverCheckResult | null;
  note: string;
};

/** A photo or scan (signed BAST, surat jalan, the goods), in the `production` GridFS bucket. */
export type ProductionHandoverPhoto = {
  _id?: Types.ObjectId;
  gridFsId: Types.ObjectId;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: Types.ObjectId | null;
  uploadedAt: Date;
};

/**
 * Serah Terima: units a subcon / outsource vendor handed over on one SPK,
 * checked and with proof. Posting it creates the SPK's production report;
 * voiding it voids that report. One SPK can have several (partial deliveries).
 */
export interface ProductionHandoverInterface {
  number: string;
  projectId: Types.ObjectId;
  productionOrderId: Types.ObjectId;
  /** Copied from the SPK so per-item roll-ups need no join. */
  shopDrawingItemId: Types.ObjectId;
  status: ProductionHandoverStatus;
  /** YYYY-MM-DD (Jakarta). */
  handoverDate: string;
  /** Units accepted. */
  qty: string;
  /** Vendor's surat jalan number, if any. */
  deliveryNoteNumber: string;
  receivedByUserId?: Types.ObjectId | null;
  receivedByName: string;
  notes: string;
  checklist: ProductionHandoverCheck[];
  photos: ProductionHandoverPhoto[];
  /** The report created on post. */
  productionReportId?: Types.ObjectId | null;
  createdBy?: Types.ObjectId;
  postedAt?: Date | null;
  postedBy?: Types.ObjectId | null;
  voidedAt?: Date | null;
  voidedBy?: Types.ObjectId | null;
  voidReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const checkSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    result: { type: String, enum: [...HANDOVER_CHECK_RESULTS, null], default: null },
    note: { type: String, trim: true, default: "" },
  },
  { _id: false },
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

const productionHandoverSchema = new Schema<ProductionHandoverInterface>(
  {
    number: { type: String, required: true, unique: true, trim: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    productionOrderId: {
      type: Schema.Types.ObjectId,
      ref: "ProductionOrder",
      required: true,
      index: true,
    },
    shopDrawingItemId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingItem",
      required: true,
    },
    status: {
      type: String,
      enum: PRODUCTION_HANDOVER_STATUSES,
      required: true,
      default: "draft",
    },
    handoverDate: { type: String, required: true, trim: true },
    qty: { type: String, required: true, trim: true },
    deliveryNoteNumber: { type: String, trim: true, default: "" },
    receivedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    receivedByName: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    checklist: { type: [checkSchema], default: [] },
    photos: { type: [photoSchema], default: [] },
    productionReportId: { type: Schema.Types.ObjectId, ref: "ProductionReport", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    postedAt: { type: Date, default: null },
    postedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

export const ProductionHandoverRepo = auditedModel<ProductionHandoverInterface>(
  "ProductionHandover",
  productionHandoverSchema,
);
