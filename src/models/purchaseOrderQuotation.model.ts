import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

/**
 * Vendor quotation on a PO, versioned like project documents: each
 * negotiation round is a new version and one version is current. Blobs live
 * in the purchasing GridFS bucket and are shared by content hash.
 */
export interface PurchaseOrderQuotationInterface {
  purchaseOrderId: Types.ObjectId;
  version: number;
  isCurrent: boolean;
  gridFsId: Types.ObjectId;
  contentHash: string;
  /** True when uploaded with ?force=true — skip “same as” labeling. */
  forceDifferent: boolean;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const purchaseOrderQuotationSchema = new Schema<PurchaseOrderQuotationInterface>(
  {
    purchaseOrderId: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseOrder",
      required: true,
      index: true,
    },
    version: { type: Number, required: true, min: 1 },
    isCurrent: { type: Boolean, required: true, default: true },
    gridFsId: { type: Schema.Types.ObjectId, required: true },
    contentHash: { type: String, required: true, trim: true, index: true },
    forceDifferent: { type: Boolean, required: true, default: false },
    originalFilename: { type: String, required: true, trim: true },
    contentType: { type: String, required: true, trim: true },
    sizeBytes: { type: Number, required: true, min: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    isDeleted: { type: Boolean, required: true, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

purchaseOrderQuotationSchema.index({ purchaseOrderId: 1, version: 1 }, { unique: true });

export const PurchaseOrderQuotationRepo = auditedModel<PurchaseOrderQuotationInterface>(
  "PurchaseOrderQuotation",
  purchaseOrderQuotationSchema,
);
