import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

/** File Produksi (CNC / cutting / laser files): versioned per shop drawing item. */
export interface ProjectProductionFileInterface {
  projectId: Types.ObjectId;
  itemId: Types.ObjectId;
  version: number;
  isCurrent: boolean;
  gridFsId: Types.ObjectId;
  contentHash: string;
  forceDifferent: boolean;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: Types.ObjectId;
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const projectProductionFileSchema = new Schema<ProjectProductionFileInterface>(
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
    version: { type: Number, required: true, min: 1 },
    isCurrent: { type: Boolean, required: true, default: true },
    gridFsId: { type: Schema.Types.ObjectId, required: true },
    contentHash: { type: String, required: true, trim: true, index: true },
    forceDifferent: { type: Boolean, required: true, default: false },
    originalFilename: { type: String, required: true, trim: true },
    contentType: { type: String, required: true, trim: true },
    sizeBytes: { type: Number, required: true, min: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, required: true, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

projectProductionFileSchema.index({ itemId: 1, version: 1 }, { unique: true });
projectProductionFileSchema.index({ projectId: 1, version: -1 });
projectProductionFileSchema.index(
  { projectId: 1, isCurrent: 1 },
  { partialFilterExpression: { isCurrent: true } },
);

export const ProjectProductionFileRepo =
  auditedModel<ProjectProductionFileInterface>(
    "ProjectProductionFile",
    projectProductionFileSchema,
  );
