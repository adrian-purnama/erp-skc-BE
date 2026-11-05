import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";
import {
  PROJECT_RAB_LABOUR_EXECUTORS,
  PROJECT_RAB_LABOUR_ROLES,
  type ProjectRabLabourExecutor,
  type ProjectRabLabourRole,
} from "./projectRab.model";

export const PRODUCTION_ORDER_STATUSES = [
  "draft",
  "released",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type ProductionOrderStatus = (typeof PRODUCTION_ORDER_STATUSES)[number];

export type ProductionOrderMaterial = {
  materialItemId: Types.ObjectId;
  itemUomId: Types.ObjectId;
  /** Σ BOQ qtyPerUnit for this material×UOM (per 1 unit made). */
  qtyPerUnit: string;
  /** To request / issue: exactQty rounded by the RAB rule, cumulatively over the item's SPKs. */
  qty: string;
  /** qtyPerUnit × order qty before rounding; absent on SPKs released before rounding. */
  exactQty?: string;
};

/** What the SPK was released with; later BOQ / file changes do not touch it. */
export type ProductionOrderSnapshot = {
  makeQty: string;
  /** Null on outsource items, which have no BOQ. */
  boqId: Types.ObjectId | null;
  shopDrawingFileId: Types.ObjectId;
  shopDrawingFileVersion: number;
  /** Null when the item has no File Produksi (optional on outsource items). */
  productionFileId: Types.ObjectId | null;
  productionFileVersion: number | null;
  /** BOQ materials (sequence-1 making SPKs only) plus, for vendor SPKs, the fee line. */
  materials: ProductionOrderMaterial[];
  /** Making stage weight % at release; null on install SPKs. */
  weightPercent?: number | null;
};

/**
 * SPK Produksi: one RAB labour line (a making stage or install) of one shop
 * drawing item, for a qty. Its RAB line key is
 * `${shopDrawingItemId}:${labourItemId}:${labourUomId}`.
 */
export interface ProductionOrderInterface {
  projectId: Types.ObjectId;
  shopDrawingItemId: Types.ObjectId;
  number: string;
  labourItemId: Types.ObjectId;
  labourUomId: Types.ObjectId;
  /** Labour item name (display), refreshed at release. */
  labourName: string;
  /** From the RAB line, refreshed at release. */
  role: ProjectRabLabourRole;
  executor: ProjectRabLabourExecutor;
  /** Making stage order from the RAB line; null on install SPKs. */
  sequence: number | null;
  qty: string;
  status: ProductionOrderStatus;
  /** YYYY-MM-DD or null. */
  plannedStart?: string | null;
  plannedFinish?: string | null;
  /** Person in charge: a user; `pic` keeps their display name at the time. */
  picUserId?: Types.ObjectId | null;
  pic: string;
  notes: string;
  snapshot?: ProductionOrderSnapshot | null;
  createdBy?: Types.ObjectId;
  releasedAt?: Date | null;
  releasedBy?: Types.ObjectId | null;
  /** Issuer's full name at release, printed as the SPK signer. */
  releasedByName?: string;
  completedAt?: Date | null;
  completedBy?: Types.ObjectId | null;
  /** Required when completed with less than the planned qty. */
  completeNote?: string;
  cancelledAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancelReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const materialSchema = new Schema(
  {
    materialItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemUomId: { type: Schema.Types.ObjectId, ref: "ItemUom", required: true },
    qtyPerUnit: { type: String, required: true, trim: true },
    qty: { type: String, required: true, trim: true },
    exactQty: { type: String, trim: true },
  },
  { _id: false },
);

const snapshotSchema = new Schema(
  {
    makeQty: { type: String, required: true, trim: true },
    boqId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingBoq",
      default: null,
    },
    shopDrawingFileId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingDocument",
      required: true,
    },
    shopDrawingFileVersion: { type: Number, required: true },
    productionFileId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectProductionFile",
      default: null,
    },
    productionFileVersion: { type: Number, default: null },
    materials: { type: [materialSchema], default: [] },
    weightPercent: { type: Number, default: null },
  },
  { _id: false },
);

const productionOrderSchema = new Schema<ProductionOrderInterface>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    shopDrawingItemId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingItem",
      required: true,
      index: true,
    },
    number: { type: String, required: true, unique: true, trim: true },
    labourItemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    labourUomId: { type: Schema.Types.ObjectId, ref: "ItemUom", required: true },
    labourName: { type: String, trim: true, default: "" },
    role: { type: String, enum: PROJECT_RAB_LABOUR_ROLES, required: true, default: "making" },
    executor: {
      type: String,
      enum: PROJECT_RAB_LABOUR_EXECUTORS,
      required: true,
      default: "inhouse",
    },
    sequence: { type: Number, default: null },
    qty: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: PRODUCTION_ORDER_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    plannedStart: { type: String, default: null },
    plannedFinish: { type: String, default: null },
    picUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    pic: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    snapshot: { type: snapshotSchema, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    releasedAt: { type: Date, default: null },
    releasedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    releasedByName: { type: String, trim: true, default: "" },
    completedAt: { type: Date, default: null },
    completedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    completeNote: { type: String, trim: true, default: "" },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

productionOrderSchema.index({ projectId: 1, shopDrawingItemId: 1, status: 1 });
productionOrderSchema.index({ shopDrawingItemId: 1, labourItemId: 1, labourUomId: 1 });
productionOrderSchema.index({ status: 1, createdAt: -1 });

export const ProductionOrderRepo = auditedModel<ProductionOrderInterface>(
  "ProductionOrder",
  productionOrderSchema,
);
