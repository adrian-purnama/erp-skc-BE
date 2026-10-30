import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

export const MATERIAL_DISPATCH_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "rejected",
  "cancelled",
  "voided",
] as const;
export type MaterialDispatchStatus = (typeof MATERIAL_DISPATCH_STATUSES)[number];

/** Dispatches that hold material against what arrived at us (a rejected one is checked again when resent). */
export const MATERIAL_DISPATCH_HOLDING: MaterialDispatchStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
];

export type MaterialDispatchLine = {
  materialItemId: Types.ObjectId;
  itemUomId: Types.ObjectId;
  qty: string;
};

/** Photo of the goods or the signed surat jalan, in the `production` GridFS bucket. */
export type MaterialDispatchPhoto = {
  _id?: Types.ObjectId;
  gridFsId: Types.ObjectId;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: Types.ObjectId | null;
  uploadedAt: Date;
};

/**
 * Surat Jalan ke vendor: our material sent from the warehouse to a subcon
 * SPK's vendor. Requested, approved by someone else, then marked sent with
 * proof. Material the supplier delivers straight to the vendor is recorded on
 * its receipt instead (`deliveredTo: "vendor"`).
 */
export interface MaterialDispatchInterface {
  number: string;
  projectId: Types.ObjectId;
  productionOrderId: Types.ObjectId;
  shopDrawingItemId: Types.ObjectId;
  /** The subcon vendor, from the SPK's approved fee PO. */
  vendorId: Types.ObjectId;
  feePurchaseOrderId: Types.ObjectId;
  status: MaterialDispatchStatus;
  /** YYYY-MM-DD planned, then the day it left. */
  dispatchDate: string;
  lines: MaterialDispatchLine[];
  notes: string;
  /** Who took the material in at the vendor. */
  receivedByName: string;
  photos: MaterialDispatchPhoto[];
  createdBy?: Types.ObjectId;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  approvedBy?: Types.ObjectId | null;
  approvedByName?: string;
  rejectedAt?: Date | null;
  rejectedBy?: Types.ObjectId | null;
  rejectReason?: string;
  sentAt?: Date | null;
  sentBy?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancelReason?: string;
  voidedAt?: Date | null;
  voidedBy?: Types.ObjectId | null;
  voidReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema(
  {
    materialItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemUomId: { type: Schema.Types.ObjectId, ref: "ItemUom", required: true },
    qty: { type: String, required: true, trim: true },
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

const materialDispatchSchema = new Schema<MaterialDispatchInterface>(
  {
    number: { type: String, required: true, unique: true, trim: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    productionOrderId: {
      type: Schema.Types.ObjectId,
      ref: "ProductionOrder",
      required: true,
      index: true,
    },
    shopDrawingItemId: { type: Schema.Types.ObjectId, ref: "ProjectShopDrawingItem", required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    feePurchaseOrderId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder", required: true },
    status: {
      type: String,
      enum: MATERIAL_DISPATCH_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    dispatchDate: { type: String, required: true, trim: true },
    lines: { type: [lineSchema], default: [] },
    notes: { type: String, trim: true, default: "" },
    receivedByName: { type: String, trim: true, default: "" },
    photos: { type: [photoSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    submittedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedByName: { type: String, trim: true, default: "" },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    rejectReason: { type: String, trim: true, default: "" },
    sentAt: { type: Date, default: null },
    sentBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, trim: true, default: "" },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

export const MaterialDispatchRepo = auditedModel<MaterialDispatchInterface>(
  "MaterialDispatch",
  materialDispatchSchema,
);
