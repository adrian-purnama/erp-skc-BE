import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export const PROJECT_RAB_STATUSES = ["draft", "locked"] as const;
export type ProjectRabStatus = (typeof PROJECT_RAB_STATUSES)[number];

export const PROJECT_RAB_LINE_ORIGINS = ["lock", "append"] as const;
export type ProjectRabLineOrigin = (typeof PROJECT_RAB_LINE_ORIGINS)[number];

export type ProjectRabLine = {
  /** Stable: `${materialItemId}:${itemUomId}` */
  key: string;
  materialItemId: Types.ObjectId;
  itemUomId: Types.ObjectId;
  totalQty: string;
  unitPrice?: string;
  tarifId?: Types.ObjectId;
  /** Set at lock (all then-current lines) or when appended after lock. */
  origin?: ProjectRabLineOrigin;
  addedAt?: Date;
  addedBy?: Types.ObjectId;
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
