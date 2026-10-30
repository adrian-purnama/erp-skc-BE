import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";
import { purchaseChargeSchema, type PurchaseCharge } from "./purchaseCharge.model";

/** Draft is editable; only a locked RAB can be picked on an SPP. */
export const PURCHASE_RAB_STATUSES = ["draft", "locked"] as const;
export type PurchaseRabStatus = (typeof PURCHASE_RAB_STATUSES)[number];

export type PurchaseRabLine = {
  /** `${materialItemId}:${itemUomId}`, unique within the RAB. */
  key: string;
  materialItemId: Types.ObjectId;
  itemUomId: Types.ObjectId;
  qty: string;
  /** Integer rupiah per unit. */
  unitPrice: string;
  note: string;
};

/**
 * Purchasing RAB: a budget for buying outside projects (supplies, tools, …).
 * Never tied to a project: project buying goes through an SPK and its project RAB.
 */
export interface PurchaseRabInterface {
  number: string;
  title: string;
  status: PurchaseRabStatus;
  notes: string;
  lines: PurchaseRabLine[];
  /** Budgeted tax / delivery / other costs on top of the lines. */
  charges?: PurchaseCharge[];
  createdBy?: Types.ObjectId;
  lockedAt?: Date | null;
  lockedBy?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    materialItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemUomId: { type: Schema.Types.ObjectId, ref: "ItemUom", required: true },
    qty: { type: String, required: true, trim: true },
    unitPrice: { type: String, required: true, trim: true },
    note: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const purchaseRabSchema = new Schema<PurchaseRabInterface>(
  {
    number: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: PURCHASE_RAB_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    notes: { type: String, trim: true, default: "" },
    lines: { type: [lineSchema], default: [] },
    charges: { type: [purchaseChargeSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

purchaseRabSchema.index({ createdAt: -1 });

export const PurchaseRabRepo = auditedModel<PurchaseRabInterface>("PurchaseRab", purchaseRabSchema);
