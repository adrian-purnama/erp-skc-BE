import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

/** Non-versioned file repos attached to a project (no current/version). */
export const PROJECT_LOOSE_FILE_KINDS = ["shopDrawingMap"] as const;

export type ProjectLooseFileKind = (typeof PROJECT_LOOSE_FILE_KINDS)[number];

export interface ProjectLooseFileInterface {
  projectId: Types.ObjectId;
  kind: ProjectLooseFileKind;
  gridFsId: Types.ObjectId;
  contentHash?: string | null;
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

const projectLooseFileSchema = new Schema<ProjectLooseFileInterface>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: PROJECT_LOOSE_FILE_KINDS,
      required: true,
    },
    gridFsId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    contentHash: {
      type: String,
      default: null,
      index: true,
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
  },
  { timestamps: true },
);

projectLooseFileSchema.index({ projectId: 1, kind: 1, createdAt: -1 });

export const ProjectLooseFileRepo = auditedModel<ProjectLooseFileInterface>(
  "ProjectLooseFile",
  projectLooseFileSchema,
);
