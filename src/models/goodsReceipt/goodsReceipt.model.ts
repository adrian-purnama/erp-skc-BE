import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

/** Receipts are recorded once and never edited; a mistake is voided. */
export const GOODS_RECEIPT_STATUSES = ["posted", "voided"] as const;
export type GoodsReceiptStatus = (typeof GOODS_RECEIPT_STATUSES)[number];

export type GoodsReceiptLine = {
  _id?: Types.ObjectId;
  /** `_id` of the line inside the PO. */
  poLineId: Types.ObjectId;
  /** Copied from the PO line so receipts roll up per SPP line / SPK. */
  requestLineId: Types.ObjectId;
  qty: string;
  /** Condition remark, e.g. "2 sheets dented". */
  note: string;
};

/** Penerimaan Barang: what physically arrived for an approved PO. */
export interface GoodsReceiptInterface {
  number: string;
  purchaseOrderId: Types.ObjectId;
  requestId: Types.ObjectId;
  projectId: Types.ObjectId;
  productionOrderId?: Types.ObjectId | null;
  status: GoodsReceiptStatus;
  /** YYYY-MM-DD. */
  receivedDate: string;
  receivedByUserId?: Types.ObjectId | null;
  receivedByName: string;
  /** Surat jalan / delivery note number, if any. */
  deliveryNoteNumber: string;
  notes: string;
  lines: GoodsReceiptLine[];
  createdBy?: Types.ObjectId;
  voidedAt?: Date | null;
  voidedBy?: Types.ObjectId | null;
  voidReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema(
  {
    poLineId: { type: Schema.Types.ObjectId, required: true },
    requestLineId: { type: Schema.Types.ObjectId, required: true },
    qty: { type: String, required: true, trim: true },
    note: { type: String, trim: true, default: "" },
  },
  { _id: true },
);

const goodsReceiptSchema = new Schema<GoodsReceiptInterface>(
  {
    number: { type: String, required: true, unique: true, trim: true },
    purchaseOrderId: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseOrder",
      required: true,
      index: true,
    },
    requestId: { type: Schema.Types.ObjectId, ref: "PurchaseRequest", required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    productionOrderId: { type: Schema.Types.ObjectId, ref: "ProductionOrder", default: null },
    status: {
      type: String,
      enum: GOODS_RECEIPT_STATUSES,
      required: true,
      default: "posted",
      index: true,
    },
    receivedDate: { type: String, required: true, trim: true },
    receivedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    receivedByName: { type: String, trim: true, default: "" },
    deliveryNoteNumber: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    lines: { type: [lineSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

goodsReceiptSchema.index({ status: 1, createdAt: -1 });

export const GoodsReceiptRepo = auditedModel<GoodsReceiptInterface>(
  "GoodsReceipt",
  goodsReceiptSchema,
);
