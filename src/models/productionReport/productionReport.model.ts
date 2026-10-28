import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

/** Laporan Hasil Produksi: qty finished on one SPK. Never edited, only voided. */
export interface ProductionReportInterface {
  projectId: Types.ObjectId;
  productionOrderId: Types.ObjectId;
  /** Copied from the SPK so per-item roll-ups need no join. */
  shopDrawingItemId: Types.ObjectId;
  qtyDone: string;
  /** YYYY-MM-DD (Jakarta). */
  reportDate: string;
  notes: string;
  reportedBy?: Types.ObjectId;
  isVoided: boolean;
  voidedAt?: Date | null;
  voidedBy?: Types.ObjectId | null;
  voidReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const productionReportSchema = new Schema<ProductionReportInterface>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
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
    qtyDone: { type: String, required: true, trim: true },
    reportDate: { type: String, required: true, trim: true },
    notes: { type: String, trim: true, default: "" },
    reportedBy: { type: Schema.Types.ObjectId, ref: "User" },
    isVoided: { type: Boolean, required: true, default: false },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

productionReportSchema.index({ projectId: 1, isVoided: 1 });

export const ProductionReportRepo = auditedModel<ProductionReportInterface>(
  "ProductionReport",
  productionReportSchema,
);
