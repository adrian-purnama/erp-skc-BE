import { Schema } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

/** A project category on the public website (landing page). */
export interface LandingCategoryInterface {
  slug: string;
  label: string;
  /** Order of the category filters on the website, lowest first. */
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const landingCategorySchema = new Schema<LandingCategoryInterface>(
  {
    slug: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    sortOrder: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

landingCategorySchema.index({ slug: 1 }, { unique: true });

export const LandingCategoryRepo = auditedModel<LandingCategoryInterface>(
  "LandingCategory",
  landingCategorySchema,
);
