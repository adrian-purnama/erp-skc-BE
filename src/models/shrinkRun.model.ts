import { model, Schema, type Types } from "mongoose";

export const SHRINK_RUN_STATUSES = [
  "running",
  "completed",
  "failed",
  "interrupted",
] as const;

export type ShrinkRunStatus = (typeof SHRINK_RUN_STATUSES)[number];

export const SHRINK_SECTIONS = ["audit", "documents"] as const;

export type ShrinkSection = (typeof SHRINK_SECTIONS)[number];

export type ShrinkOrphanReport = {
  shrinkBlobsPurged: number;
  unmatchedBlobIds: string[];
  scopesMissingCurrent: Array<{
    kind: "document" | "shopDrawing";
    projectId: string;
    scope: string;
  }>;
};

export type ShrinkRunResult = {
  auditDeleted: number;
  documentVersionsSoftDeleted: number;
  shopDrawingVersionsSoftDeleted: number;
  blobsPurged: number;
  errors: string[];
  orphans?: ShrinkOrphanReport;
};

export interface ShrinkRunInterface {
  startedBy: Types.ObjectId;
  startedAt: Date;
  section: ShrinkSection;
  excludedProjectIds: Types.ObjectId[];
  status: ShrinkRunStatus;
  lastHeartbeatAt: Date;
  result?: ShrinkRunResult | null;
  errorMessage?: string | null;
}

const shrinkRunSchema = new Schema<ShrinkRunInterface>(
  {
    startedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    section: {
      type: String,
      enum: SHRINK_SECTIONS,
      required: true,
    },
    excludedProjectIds: {
      type: [Schema.Types.ObjectId],
      required: true,
      default: [],
    },
    status: {
      type: String,
      enum: SHRINK_RUN_STATUSES,
      required: true,
    },
    lastHeartbeatAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    result: {
      type: Schema.Types.Mixed,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  { timestamps: false },
);

shrinkRunSchema.index({ startedAt: -1 });
shrinkRunSchema.index({ status: 1 });

export const ShrinkRunModel = model<ShrinkRunInterface>(
  "ShrinkRun",
  shrinkRunSchema,
);
