import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export interface ProjectShopDrawingItemInterface {
  projectId: Types.ObjectId;
  name: string;
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
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
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
  { projectId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  },
);

export const ProjectShopDrawingItemRepo = auditedModel<ProjectShopDrawingItemInterface>(
  "ProjectShopDrawingItem",
  projectShopDrawingItemSchema,
);
