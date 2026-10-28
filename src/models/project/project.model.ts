import { Schema } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export const PROJECT_GENDERS = ["male", "female"] as const;
export type ProjectGender = (typeof PROJECT_GENDERS)[number];

export const PROJECT_STATUSES = [
  "open",
  "win",
  "lose",
  "close",
  "completed",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_LOSE_REASONS = [
  "price",
  "competitor",
  "timing",
  "budget",
  "other",
] as const;
export type ProjectLoseReason = (typeof PROJECT_LOSE_REASONS)[number];

export const PROJECT_CLOSE_REASONS = [
  "completed",
  "cancelled_customer",
  "cancelled_internal",
  "superseded",
  "other",
] as const;
export type ProjectCloseReason = (typeof PROJECT_CLOSE_REASONS)[number];

export type ProjectCustomerContact = {
  name: string;
  gender: ProjectGender;
  contact: Record<string, string>;
};

export interface ProjectInterface {
  name: string;
  description: string;
  customerId: import("mongoose").Types.ObjectId;
  projectNumber: string;
  customerContact: ProjectCustomerContact;
  status: ProjectStatus;
  loseReason?: ProjectLoseReason | null;
  closeReason?: ProjectCloseReason | null;
  isActive?: boolean;
  /** Set once the project is released to production (all SD ready, quotation won). */
  productionReleasedAt?: Date | null;
  productionReleasedBy?: import("mongoose").Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const customerContactSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    gender: {
      type: String,
      enum: PROJECT_GENDERS,
      required: true,
    },
    contact: {
      type: Map,
      of: String,
      default: {},
    },
  },
  { _id: false },
);

const projectSchema = new Schema<ProjectInterface>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      default: "",
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    projectNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    customerContact: {
      type: customerContactSchema,
      required: true,
    },
    status: {
      type: String,
      enum: PROJECT_STATUSES,
      required: true,
      default: "open",
      index: true,
    },
    loseReason: {
      type: String,
      enum: PROJECT_LOSE_REASONS,
      default: null,
    },
    closeReason: {
      type: String,
      enum: PROJECT_CLOSE_REASONS,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    productionReleasedAt: {
      type: Date,
      default: null,
    },
    productionReleasedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

projectSchema.index({ name: 1 });
projectSchema.index({ projectNumber: 1 });
projectSchema.index({ status: 1 });

export const ProjectRepo = auditedModel<ProjectInterface>(
  "Project",
  projectSchema,
);
