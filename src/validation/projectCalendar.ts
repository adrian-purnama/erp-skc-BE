import type {
  CreateProjectCalendarEventDto,
  UpdateProjectCalendarEventDto,
} from "../dto/projectCalendar.dto";
import {
  PROJECT_CALENDAR_EVENT_TYPES,
  type ProjectCalendarEventType,
} from "../models/projectCalendarEvent/projectCalendarEvent.model";
import { asRecord } from "./asRecord";

function parseType(raw: unknown): ProjectCalendarEventType {
  if (
    typeof raw !== "string" ||
    !PROJECT_CALENDAR_EVENT_TYPES.includes(raw as ProjectCalendarEventType)
  ) {
    throw new Error("type must be range or deadline");
  }
  return raw as ProjectCalendarEventType;
}

function parseDate(raw: unknown, label: string): Date {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${label} is required`);
  }
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${label} must be a valid ISO date`);
  }
  return d;
}

function assertRangeDates(type: ProjectCalendarEventType, startAt: Date, endAt: Date | null) {
  if (type === "deadline") {
    if (endAt !== null) {
      throw new Error("deadline must not have endAt");
    }
    return;
  }
  if (!endAt) {
    throw new Error("range requires endAt");
  }
  if (endAt.getTime() < startAt.getTime()) {
    throw new Error("endAt must be on or after startAt");
  }
}

export function parseCreateProjectCalendarEventDto(
  body: unknown,
): CreateProjectCalendarEventDto {
  const row = asRecord(body);
  const type = parseType(row.type);
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (!title) throw new Error("title is required");
  const notes =
    typeof row.notes === "string" ? row.notes.trim() : undefined;
  const startAt = parseDate(row.startAt, "startAt");
  let endAt: Date | null = null;
  if (type === "range") {
    endAt = parseDate(row.endAt, "endAt");
  } else if (row.endAt !== undefined && row.endAt !== null && row.endAt !== "") {
    throw new Error("deadline must not have endAt");
  }
  assertRangeDates(type, startAt, endAt);
  return {
    type,
    title,
    notes,
    startAt: startAt.toISOString(),
    endAt: endAt ? endAt.toISOString() : null,
  };
}

export function parseUpdateProjectCalendarEventDto(
  body: unknown,
): UpdateProjectCalendarEventDto {
  const row = asRecord(body);
  const out: UpdateProjectCalendarEventDto = {};

  if (row.type !== undefined) {
    out.type = parseType(row.type);
  }
  if (row.title !== undefined) {
    if (typeof row.title !== "string" || !row.title.trim()) {
      throw new Error("title must be a non-empty string");
    }
    out.title = row.title.trim();
  }
  if (row.notes !== undefined) {
    if (typeof row.notes !== "string") {
      throw new Error("notes must be a string");
    }
    out.notes = row.notes.trim();
  }
  if (row.startAt !== undefined) {
    out.startAt = parseDate(row.startAt, "startAt").toISOString();
  }
  if (row.endAt !== undefined) {
    if (row.endAt === null || row.endAt === "") {
      out.endAt = null;
    } else {
      out.endAt = parseDate(row.endAt, "endAt").toISOString();
    }
  }

  if (
    out.type === undefined &&
    out.title === undefined &&
    out.notes === undefined &&
    out.startAt === undefined &&
    out.endAt === undefined
  ) {
    throw new Error("No fields to update");
  }

  return out;
}

export function parseNearDays(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 7;
  const n = typeof raw === "string" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 90) {
    throw new Error("nearDays must be between 1 and 90");
  }
  return Math.floor(n);
}
