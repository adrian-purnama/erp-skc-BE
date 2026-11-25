import { Schema, Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

/** A WebP image in the GridFS "public" bucket, served at /media/:fileId. */
export interface LandingImage {
  _id?: Types.ObjectId;
  fileId: Types.ObjectId;
  width: number;
  height: number;
}

/** A project post shown on the public website. */
export interface LandingPostInterface {
  categoryId: Types.ObjectId;
  slug: string;
  title: string;
  place: string;
  featured: boolean;
  /** Only published posts with a cover reach the website. */
  published: boolean;
  cover?: LandingImage | null;
  logo?: LandingImage | null;
  /** Website order: first image first. */
  gallery: LandingImage[];
  createdAt?: Date;
  updatedAt?: Date;
}

const landingImageSchema = new Schema<LandingImage>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: true },
);

const landingPostSchema = new Schema<LandingPostInterface>(
  {
    categoryId: { type: Schema.Types.ObjectId, required: true },
    slug: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    place: { type: String, required: true, trim: true },
    featured: { type: Boolean, required: true, default: false },
    published: { type: Boolean, required: true, default: false },
    cover: { type: landingImageSchema, required: false, default: null },
    logo: { type: landingImageSchema, required: false, default: null },
    gallery: { type: [landingImageSchema], required: true, default: () => [] },
  },
  { timestamps: true },
);

landingPostSchema.index({ categoryId: 1, slug: 1 }, { unique: true });

export const LandingPostRepo = auditedModel<LandingPostInterface>(
  "LandingPost",
  landingPostSchema,
);
