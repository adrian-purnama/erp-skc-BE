import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";
import {
  PROJECT_RAB_LINE_ORIGINS,
  projectRabLineRoundingSchema,
  type ProjectRabLine,
} from "../projectRab/projectRab.model";
import type {
  ProjectShopDrawingBoqLighting,
  ProjectShopDrawingBoqMain,
  ProjectShopDrawingBoqMounting,
  ProjectShopDrawingBoqOther,
} from "../projectShopDrawingBoq/projectShopDrawingBoq.model";

export const PROJECT_RAB_CHANGE_STATUSES = [
  "draft",
  "committed",
  "discarded",
] as const;
export type ProjectRabChangeStatus = (typeof PROJECT_RAB_CHANGE_STATUSES)[number];

/** Working / historical BOQ snapshot inside a RAB change. */
export type ProjectRabChangeBoqSnapshot = {
  shopDrawingItemId: Types.ObjectId;
  shopDrawingFileId: Types.ObjectId;
  makeQty: string;
  mockupApproveDate?: string | null;
  main: ProjectShopDrawingBoqMain;
  lighting: ProjectShopDrawingBoqLighting;
  mounting: ProjectShopDrawingBoqMounting;
  other: ProjectShopDrawingBoqOther;
};

/** Which file version of a shop drawing item feeds the RAB. */
export type ProjectRabChangeCurrentFile = {
  shopDrawingItemId: Types.ObjectId;
  shopDrawingFileId: Types.ObjectId;
};

export interface ProjectRabChangeInterface {
  projectId: Types.ObjectId;
  reason: string;
  status: ProjectRabChangeStatus;
  openedBy: Types.ObjectId;
  openedAt: Date;
  committedBy?: Types.ObjectId;
  committedAt?: Date;
  /** Set on commit: 1, 2, … per project. Absent on draft/discarded. */
  revision?: number;
  /** Immutable copy at open — used to compute added/removed/changed. */
  baselineBoqs: ProjectRabChangeBoqSnapshot[];
  baselineRabLines: ProjectRabLine[];
  boqs: ProjectRabChangeBoqSnapshot[];
  rabLines: ProjectRabLine[];
  /** Current file per item when the change was opened (restored on discard). */
  baselineCurrentFiles?: ProjectRabChangeCurrentFile[];
  /** Current file per item at commit. Absent on draft / legacy records. */
  currentFiles?: ProjectRabChangeCurrentFile[];
  /** Shop drawing items removed in this change; hard-deleted on commit, kept on discard. */
  removedItemIds?: Types.ObjectId[];
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

const projectRabChangeBoqSchema = new Schema(
  {
    shopDrawingItemId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingItem",
      required: true,
    },
    shopDrawingFileId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingDocument",
      required: true,
    },
    makeQty: { type: String, required: true, trim: true },
    mockupApproveDate: {
      type: String,
      required: false,
      default: null,
      trim: true,
    },
    main: { type: Schema.Types.Mixed, required: true },
    lighting: { type: Schema.Types.Mixed, required: true },
    mounting: { type: Schema.Types.Mixed, required: true },
    other: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const projectRabChangeCurrentFileSchema = new Schema(
  {
    shopDrawingItemId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingItem",
      required: true,
    },
    shopDrawingFileId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingDocument",
      required: true,
    },
  },
  { _id: false },
);

const projectRabChangeSchema = new Schema<ProjectRabChangeInterface>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    reason: { type: String, required: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: PROJECT_RAB_CHANGE_STATUSES,
      default: "draft",
      index: true,
    },
    openedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    openedAt: { type: Date, required: true },
    committedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    committedAt: { type: Date, required: false },
    revision: { type: Number, required: false, min: 1 },
    baselineBoqs: {
      type: [projectRabChangeBoqSchema],
      required: true,
      default: [],
    },
    baselineRabLines: {
      type: [projectRabLineSchema],
      required: true,
      default: [],
    },
    boqs: {
      type: [projectRabChangeBoqSchema],
      required: true,
      default: [],
    },
    rabLines: {
      type: [projectRabLineSchema],
      required: true,
      default: [],
    },
    baselineCurrentFiles: {
      type: [projectRabChangeCurrentFileSchema],
      required: false,
      default: undefined,
    },
    currentFiles: {
      type: [projectRabChangeCurrentFileSchema],
      required: false,
      default: undefined,
    },
    removedItemIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "ProjectShopDrawingItem" }],
      required: false,
      default: undefined,
    },
  },
  { timestamps: true },
);

/** At most one open draft change per project. */
projectRabChangeSchema.index(
  { projectId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "draft" },
  },
);

/** Committed history (newest first) and the latest revision per project. */
projectRabChangeSchema.index({ projectId: 1, status: 1, committedAt: -1 });
projectRabChangeSchema.index({ projectId: 1, status: 1, revision: -1 });

export const ProjectRabChangeRepo = auditedModel<ProjectRabChangeInterface>(
  "ProjectRabChange",
  projectRabChangeSchema,
);
