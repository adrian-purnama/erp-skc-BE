import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";
import { purchaseChargeSchema, type PurchaseCharge } from "./purchaseCharge.model";

export const VENDOR_INVOICE_STATUSES = ["draft", "posted", "voided"] as const;
export type VendorInvoiceStatus = (typeof VENDOR_INVOICE_STATUSES)[number];

/** The invoiced price of one GR line. */
export type VendorInvoiceLine = {
  _id?: Types.ObjectId;
  realizationId: Types.ObjectId;
  /** `_id` of the line inside the GR. */
  realizationLineId: Types.ObjectId;
  poLineId: Types.ObjectId;
  /** Copied from the GR line. */
  qty: string;
  /** Actual integer rupiah per unit. */
  unitPrice: string;
  note: string;
};

/** Invoice scan / photo, in the `purchasing` GridFS bucket. */
export type VendorInvoiceFile = {
  _id?: Types.ObjectId;
  gridFsId: Types.ObjectId;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: Types.ObjectId | null;
  uploadedAt: Date;
};

/**
 * What a vendor billed for one or more whole GRs of one PO: the only place
 * vendor prices and charges are typed. Posting it prices its GRs; no approval
 * of its own (the payment is approved).
 */
export interface VendorInvoiceInterface {
  number: string;
  purchaseOrderId: Types.ObjectId;
  vendorId: Types.ObjectId;
  /** The number printed on the vendor's invoice. */
  vendorInvoiceNumber: string;
  /** YYYY-MM-DD on the vendor's invoice. */
  invoiceDate: string;
  dueDate?: string | null;
  status: VendorInvoiceStatus;
  /** Covered GRs, in the order they were posted. */
  realizationIds: Types.ObjectId[];
  lines: VendorInvoiceLine[];
  charges: PurchaseCharge[];
  subtotal: string;
  chargesTotal: string;
  total: string;
  files: VendorInvoiceFile[];
  notes: string;
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
    realizationId: { type: Schema.Types.ObjectId, ref: "PurchaseRealization", required: true },
    realizationLineId: { type: Schema.Types.ObjectId, required: true },
    poLineId: { type: Schema.Types.ObjectId, required: true },
    qty: { type: String, required: true, trim: true },
    unitPrice: { type: String, required: true, trim: true },
    note: { type: String, trim: true, default: "" },
  },
  { _id: true },
);

const fileSchema = new Schema(
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

const vendorInvoiceSchema = new Schema<VendorInvoiceInterface>(
  {
    number: { type: String, required: true, unique: true, trim: true },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder", required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    vendorInvoiceNumber: { type: String, trim: true, default: "", index: true },
    invoiceDate: { type: String, required: true, trim: true },
    dueDate: { type: String, default: null },
    status: { type: String, enum: VENDOR_INVOICE_STATUSES, required: true, default: "draft", index: true },
    realizationIds: { type: [Schema.Types.ObjectId], default: [] },
    lines: { type: [lineSchema], default: [] },
    charges: { type: [purchaseChargeSchema], default: [] },
    subtotal: { type: String, required: true, default: "0" },
    chargesTotal: { type: String, required: true, default: "0" },
    total: { type: String, required: true, default: "0" },
    files: { type: [fileSchema], default: [] },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    postedAt: { type: Date, default: null },
    postedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

vendorInvoiceSchema.index({ realizationIds: 1 });
vendorInvoiceSchema.index({ status: 1, createdAt: -1 });

export const VendorInvoiceRepo = auditedModel<VendorInvoiceInterface>("VendorInvoice", vendorInvoiceSchema);
