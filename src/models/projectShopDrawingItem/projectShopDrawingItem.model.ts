import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export interface ProjectShopDrawingItemInterface {
  projectId: Types.ObjectId;
  /** Kode, e.g. "SA1"; shown as `{code}-{name}`. */
  code?: string;
  name: string;
  /** Keterangan: one spec line per entry (printed under the name). */
  descriptions?: string[];
  /** Ukuran, free text such as "600 x 3 x 500" (p x tebal x t mm). */
  dimension?: string;
  /** Free-text grouping label; distinct values per project form the category list. */
  category?: string | null;
  /** YYYY-MM-DD when client mockup was approved; null/absent if not needed or not yet. */
  mockupApproveDate?: string | null;
  createdBy?: Types.ObjectId;
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const projectShopDrawingItemSchema = new Schema<ProjectShopDrawingItemInterface>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    code: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "",
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    descriptions: {
      type: [String],
      default: [],
    },
    dimension: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    category: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
    },
    mockupApproveDate: {
      type: String,
      required: false,
      default: null,
      trim: true,
    },
    createdBy: {
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
  },
  { timestamps: true },
);

projectShopDrawingItemSchema.index(
  { projectId: 1, code: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false, code: { $gt: "" } },
  },
);

/** Live items of a project in list order. */
projectShopDrawingItemSchema.index({ projectId: 1, isDeleted: 1, code: 1, name: 1 });

export const ProjectShopDrawingItemRepo = auditedModel<ProjectShopDrawingItemInterface>(
  "ProjectShopDrawingItem",
  projectShopDrawingItemSchema,
);
