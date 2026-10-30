import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

/**
 * draft → submitted; the requester may cancel, purchasing may decline (both
 * with a reason). Ordering progress is derived from POs.
 */
export const PURCHASE_REQUEST_STATUSES = ["draft", "submitted", "cancelled", "declined"] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

/**
 * `spk` / `rab`: on the SPK material list / the Purchasing RAB the SPP is for;
 * `extra`: any other item, needs a reason.
 */
export const PURCHASE_REQUEST_LINE_SOURCES = ["spk", "rab", "extra"] as const;
export type PurchaseRequestLineSource = (typeof PURCHASE_REQUEST_LINE_SOURCES)[number];

export type PurchaseRequestLine = {
  _id?: Types.ObjectId;
  source: PurchaseRequestLineSource;
  materialItemId: Types.ObjectId;
  itemUomId: Types.ObjectId;
  qty: string;
  /** Material×UOM is on the RAB (project RAB, or the Purchasing RAB) when saved. */
  inRab: boolean;
  /** SPK / RAB lines: this request pushed the total past the planned qty. */
  overPlan: boolean;
  /** Required for extra and over-plan lines. */
  note: string;
};

/**
 * SPP (Surat Permintaan Pembelian): what is to be bought, for one SPK or one
 * Purchasing RAB. Older SPPs may have neither (project extras only).
 */
export interface PurchaseRequestInterface {
  number: string;
  /** From the SPK; null for a Purchasing RAB SPP. */
  projectId?: Types.ObjectId | null;
  productionOrderId?: Types.ObjectId | null;
  purchaseRabId?: Types.ObjectId | null;
  status: PurchaseRequestStatus;
  /** YYYY-MM-DD. */
  neededDate: string;
  notes: string;
  lines: PurchaseRequestLine[];
  createdBy?: Types.ObjectId;
  submittedAt?: Date | null;
  submittedBy?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancelReason?: string;
  declinedAt?: Date | null;
  declinedBy?: Types.ObjectId | null;
  declineReason?: string;
  /** The requester confirmed they got everything, after it all arrived. */
  receivedAt?: Date | null;
  receivedBy?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema(
  {
    source: { type: String, enum: PURCHASE_REQUEST_LINE_SOURCES, required: true },
    materialItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemUomId: { type: Schema.Types.ObjectId, ref: "ItemUom", required: true },
    qty: { type: String, required: true, trim: true },
    inRab: { type: Boolean, required: true, default: false },
    overPlan: { type: Boolean, required: true, default: false },
    note: { type: String, trim: true, default: "" },
  },
  { _id: true },
);

const purchaseRequestSchema = new Schema<PurchaseRequestInterface>(
  {
    number: { type: String, required: true, unique: true, trim: true },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      default: null,
      index: true,
    },
    productionOrderId: {
      type: Schema.Types.ObjectId,
      ref: "ProductionOrder",
      default: null,
      index: true,
    },
    purchaseRabId: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseRab",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: PURCHASE_REQUEST_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    neededDate: { type: String, required: true, trim: true },
    notes: { type: String, trim: true, default: "" },
    lines: { type: [lineSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    submittedAt: { type: Date, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, trim: true, default: "" },
    declinedAt: { type: Date, default: null },
    declinedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    declineReason: { type: String, trim: true, default: "" },
    receivedAt: { type: Date, default: null },
    receivedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

purchaseRequestSchema.index({ status: 1, createdAt: -1 });

export const PurchaseRequestRepo = auditedModel<PurchaseRequestInterface>(
  "PurchaseRequest",
  purchaseRequestSchema,
);
