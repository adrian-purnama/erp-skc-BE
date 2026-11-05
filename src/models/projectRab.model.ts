import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";
import {
  ITEM_UOM_ROUNDING_MODES,
  type ItemUomRoundingMode,
} from "./itemUom.model";
import { purchaseChargeSchema, type PurchaseCharge } from "./purchaseCharge.model";

/** `item`: decimals set on the item's UOM row. `unit`: the UOM's own decimals. */
export const PROJECT_RAB_ROUNDING_SOURCES = ["item", "unit"] as const;
export type ProjectRabRoundingSource =
  (typeof PROJECT_RAB_ROUNDING_SOURCES)[number];

/** Purchase qty is exactQty rounded by `mode` to a multiple of `step` (line UOM). */
export type ProjectRabLineRounding = {
  step: string;
  source: ProjectRabRoundingSource;
  mode: ItemUomRoundingMode;
};

export const PROJECT_RAB_STATUSES = ["draft", "locked"] as const;
export type ProjectRabStatus = (typeof PROJECT_RAB_STATUSES)[number];

export const PROJECT_RAB_LINE_ORIGINS = ["lock", "append", "labour"] as const;
export type ProjectRabLineOrigin = (typeof PROJECT_RAB_LINE_ORIGINS)[number];

/** Labour: a making stage (weighted, sequenced) or installing the finished pcs. */
export const PROJECT_RAB_LABOUR_ROLES = ["making", "install"] as const;
export type ProjectRabLabourRole = (typeof PROJECT_RAB_LABOUR_ROLES)[number];

/** Labour: done by our own crew or by a vendor (the line is then the vendor fee). */
export const PROJECT_RAB_LABOUR_EXECUTORS = ["inhouse", "vendor"] as const;
export type ProjectRabLabourExecutor = (typeof PROJECT_RAB_LABOUR_EXECUTORS)[number];

export type ProjectRabLine = {
  /**
   * Stable: `${materialItemId}:${itemUomId}`; labour per shop drawing item:
   * `${shopDrawingItemId}:${materialItemId}:${itemUomId}`.
   */
  key: string;
  materialItemId: Types.ObjectId;
  itemUomId: Types.ObjectId;
  /** Purchase qty (exactQty rounded by the rule); priced quantity. */
  totalQty: string;
  /** Σ BOQ need before rounding; absent on labour lines. */
  exactQty?: string;
  /** Rounding rule applied, snapshotted with the line. */
  rounding?: ProjectRabLineRounding;
  unitPrice?: string;
  tarifId?: Types.ObjectId;
  /** Price was typed as the line total (unitPrice = total ÷ totalQty). */
  priceByTotal?: boolean;
  /** Set at lock (all then-current lines) or when appended after lock. */
  origin?: ProjectRabLineOrigin;
  addedAt?: Date;
  addedBy?: Types.ObjectId;
  /** Why this line was added after RAB lock (append / labour). */
  addReason?: string;
  /** Labour only: the shop drawing item it belongs to (absent = project-wide). */
  shopDrawingItemId?: Types.ObjectId;
  /** Labour only; absent = making. */
  role?: ProjectRabLabourRole;
  /** Labour only; absent = inhouse. */
  executor?: ProjectRabLabourExecutor;
  /**
   * Making labour: stage order within the drawing (1..n, unique).
   * Absent on install labour.
   */
  sequence?: number;
  /**
   * Making labour: stage weight percent (1–100). The drawing's making
   * weights must sum to 100 before release. Absent on install labour.
   */
  weightPercent?: number;
};

export interface ProjectRabInterface {
  projectId: Types.ObjectId;
  status: ProjectRabStatus;
  lines: ProjectRabLine[];
  /** Extra costs on the whole RAB (percent of the line subtotal, or fixed rupiah). */
  charges?: PurchaseCharge[];
  lockedAt?: Date;
  lockedBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export const projectRabLineRoundingSchema = new Schema(
  {
    step: { type: String, required: true, trim: true },
    source: {
      type: String,
      required: true,
      enum: PROJECT_RAB_ROUNDING_SOURCES,
    },
    mode: { type: String, required: true, enum: ITEM_UOM_ROUNDING_MODES },
  },
  { _id: false },
);

/** Shared by RAB and RAB change snapshots so line fields never drift apart. */
export const projectRabLineSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    materialItemId: {
      type: Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
    itemUomId: {
      type: Schema.Types.ObjectId,
      ref: "ItemUom",
      required: true,
    },
    totalQty: { type: String, required: true, trim: true },
    exactQty: { type: String, required: false, trim: true },
    rounding: { type: projectRabLineRoundingSchema, required: false },
    unitPrice: { type: String, required: false, trim: true },
    tarifId: {
      type: Schema.Types.ObjectId,
      ref: "ItemTarif",
      required: false,
    },
    priceByTotal: { type: Boolean, required: false },
    origin: {
      type: String,
      required: false,
      enum: PROJECT_RAB_LINE_ORIGINS,
    },
    addedAt: { type: Date, required: false },
    addedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    addReason: { type: String, required: false, trim: true },
    shopDrawingItemId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingItem",
      required: false,
    },
    role: { type: String, required: false, enum: PROJECT_RAB_LABOUR_ROLES },
    executor: { type: String, required: false, enum: PROJECT_RAB_LABOUR_EXECUTORS },
    sequence: { type: Number, required: false, min: 1 },
    weightPercent: { type: Number, required: false, min: 1, max: 100 },
  },
  { _id: false },
);

const projectRabSchema = new Schema<ProjectRabInterface>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: PROJECT_RAB_STATUSES,
      default: "draft",
    },
    lines: {
      type: [projectRabLineSchema],
      required: true,
      default: [],
    },
    charges: { type: [purchaseChargeSchema], default: [] },
    lockedAt: { type: Date, required: false },
    lockedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true },
);

export const ProjectRabRepo = auditedModel<ProjectRabInterface>(
  "ProjectRab",
  projectRabSchema,
);
