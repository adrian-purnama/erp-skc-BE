import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

export interface ProjectShopDrawingDocumentInterface {
  projectId: Types.ObjectId;
  itemId: Types.ObjectId;
  version: number;
  isCurrent: boolean;
  gridFsId: Types.ObjectId;
  contentHash: string;
  /** True when uploaded with ?force=true — skip “same as” labeling. */
  forceDifferent: boolean;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: Types.ObjectId;
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  deletedReason?: "shrink_db" | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const projectShopDrawingDocumentSchema = new Schema<ProjectShopDrawingDocumentInterface>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    itemId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingItem",
      required: true,
      index: true,
    },
    version: {
      type: Number,
      required: true,
      min: 1,
    },
    isCurrent: {
      type: Boolean,
      required: true,
      default: true,
    },
    gridFsId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    contentHash: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    forceDifferent: {
      type: Boolean,
      required: true,
      default: false,
    },
    originalFilename: {
      type: String,
      required: true,
      trim: true,
    },
    contentType: {
      type: String,
      required: true,
      trim: true,
    },
    sizeBytes: {
      type: Number,
      required: true,
      min: 0,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    isDeleted: {
      type: Boolean,
      required: true,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    deletedReason: {
      type: String,
      enum: ["shrink_db"],
      default: null,
    },
  },
  { timestamps: true },
);

projectShopDrawingDocumentSchema.index(
  { itemId: 1, version: 1 },
  { unique: true },
);
projectShopDrawingDocumentSchema.index(
  { itemId: 1, isCurrent: 1 },
  {
    partialFilterExpression: { isCurrent: true, isDeleted: false },
  },
);
projectShopDrawingDocumentSchema.index({ deletedReason: 1, isDeleted: 1 });
/** Project file lists (newest version first) and current-file lookups per project. */
projectShopDrawingDocumentSchema.index({ projectId: 1, version: -1 });
projectShopDrawingDocumentSchema.index(
  { projectId: 1, isCurrent: 1 },
  { partialFilterExpression: { isCurrent: true } },
);

export const ProjectShopDrawingDocumentRepo =
  auditedModel<ProjectShopDrawingDocumentInterface>(
    "ProjectShopDrawingDocument",
    projectShopDrawingDocumentSchema,
  );
