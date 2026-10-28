import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";
import { UOM_ROUNDING_MODES, type UomRoundingMode } from "../uom/uom.model";

export const PROJECT_RAB_STATUSES = ["draft", "locked"] as const;
export type ProjectRabStatus = (typeof PROJECT_RAB_STATUSES)[number];

export const PROJECT_RAB_LINE_ORIGINS = ["lock", "append", "labour"] as const;
export type ProjectRabLineOrigin = (typeof PROJECT_RAB_LINE_ORIGINS)[number];

export type ProjectRabLine = {
  /** Stable: `${materialItemId}:${itemUomId}` */
  key: string;
  materialItemId: Types.ObjectId;
  itemUomId: Types.ObjectId;
  /** Purchase qty (exactQty rounded by the UOM rule); priced quantity. */
  totalQty: string;
  /** Σ BOQ need before rounding; absent on labour / legacy lines. */
  exactQty?: string;
  /** UOM rounding rule applied, snapshotted with the line. */
  rounding?: { decimals: number; mode: UomRoundingMode };
  unitPrice?: string;
  tarifId?: Types.ObjectId;
  /** Set at lock (all then-current lines) or when appended after lock. */
  origin?: ProjectRabLineOrigin;
  addedAt?: Date;
  addedBy?: Types.ObjectId;
  /** Why this line was added after RAB lock (append / labour). */
  addReason?: string;
};

export interface ProjectRabInterface {
  projectId: Types.ObjectId;
  status: ProjectRabStatus;
  lines: ProjectRabLine[];
  lockedAt?: Date;
  lockedBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export const projectRabLineRoundingSchema = new Schema(
  {
    decimals: { type: Number, required: true, min: 0 },
    mode: { type: String, required: true, enum: UOM_ROUNDING_MODES },
  },
  { _id: false },
);

const projectRabLineSchema = new Schema(
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
