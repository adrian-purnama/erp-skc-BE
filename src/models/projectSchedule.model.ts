import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

/** Planned windows of one shop drawing item. Dates are YYYY-MM-DD (Jakarta). */
export type ProjectScheduleItem = {
  shopDrawingItemId: Types.ObjectId;
  makeStart?: string | null;
  makeFinish?: string | null;
  installStart?: string | null;
  installFinish?: string | null;
};

/** An item as frozen in the baseline, with its weights at that time. */
export type ProjectScheduleBaselineItem = ProjectScheduleItem & {
  /** Item bobot: share of the project, 0–100. */
  weightPercent: number;
  /** Install share inside the item, 0–100. */
  installSharePercent: number;
};

export type ProjectScheduleBaseline = {
  setAt: Date;
  setBy?: Types.ObjectId | null;
  plannedStartDate: string;
  plannedFinishDate: string;
  items: ProjectScheduleBaselineItem[];
};

/**
 * S-curve plan of a project: item windows and one frozen baseline.
 * The project's own planned start/finish live on the project.
 */
export interface ProjectScheduleInterface {
  projectId: Types.ObjectId;
  items: ProjectScheduleItem[];
  baseline?: ProjectScheduleBaseline | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const windowFields = {
  shopDrawingItemId: {
    type: Schema.Types.ObjectId,
    ref: "ProjectShopDrawingItem",
    required: true,
  },
  makeStart: { type: String, default: null },
  makeFinish: { type: String, default: null },
  installStart: { type: String, default: null },
  installFinish: { type: String, default: null },
};

const scheduleItemSchema = new Schema(windowFields, { _id: false });

const baselineItemSchema = new Schema(
  {
    ...windowFields,
    weightPercent: { type: Number, required: true },
    installSharePercent: { type: Number, required: true },
  },
  { _id: false },
);

const baselineSchema = new Schema(
  {
    setAt: { type: Date, required: true },
    setBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    plannedStartDate: { type: String, required: true },
    plannedFinishDate: { type: String, required: true },
    items: { type: [baselineItemSchema], default: [] },
  },
  { _id: false },
);

const projectScheduleSchema = new Schema<ProjectScheduleInterface>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      unique: true,
    },
    items: { type: [scheduleItemSchema], default: [] },
    baseline: { type: baselineSchema, default: null },
  },
  { timestamps: true },
);

export const ProjectScheduleRepo = auditedModel<ProjectScheduleInterface>(
  "ProjectSchedule",
  projectScheduleSchema,
);
