import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export const PROJECT_CALENDAR_EVENT_TYPES = ["range", "deadline"] as const;

export type ProjectCalendarEventType =
  (typeof PROJECT_CALENDAR_EVENT_TYPES)[number];

export interface ProjectCalendarEventInterface {
  projectId: Types.ObjectId;
  type: ProjectCalendarEventType;
  title: string;
  notes?: string;
  startAt: Date;
  endAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const projectCalendarEventSchema = new Schema<ProjectCalendarEventInterface>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: PROJECT_CALENDAR_EVENT_TYPES,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    startAt: {
      type: Date,
      required: true,
      index: true,
    },
    endAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

projectCalendarEventSchema.index({ projectId: 1, startAt: 1 });

export const ProjectCalendarEventRepo =
  auditedModel<ProjectCalendarEventInterface>(
    "ProjectCalendarEvent",
    projectCalendarEventSchema,
  );
