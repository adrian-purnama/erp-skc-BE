import { Types } from "mongoose";
import type {
  CreateProjectCalendarEventDto,
  ProjectCalendarAgendaOutDto,
  ProjectCalendarEventOutDto,
  UpdateProjectCalendarEventDto,
} from "../../dto/projectCalendar.dto";
import {
  ProjectCalendarEventRepo,
  type ProjectCalendarEventType,
} from "../../models/projectCalendarEvent.model";
import {
  addJakartaDays,
  jakartaYmdString,
} from "../../utils/shared";
import { assertProjectExists } from "./projectShared";

type LeanEvent = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  type: ProjectCalendarEventType;
  title: string;
  notes?: string;
  startAt: Date;
  endAt?: Date | null;
};

function toOut(doc: LeanEvent): ProjectCalendarEventOutDto {
  return {
    id: String(doc._id),
    projectId: String(doc.projectId),
    type: doc.type,
    title: doc.title,
    notes: doc.notes ?? "",
    startAt: new Date(doc.startAt).toISOString(),
    endAt: doc.endAt ? new Date(doc.endAt).toISOString() : null,
  };
}

export class ProjectCalendarService {
  async listByProject(projectId: string): Promise<ProjectCalendarEventOutDto[]> {
    await assertProjectExists(projectId);
    const rows = (await ProjectCalendarEventRepo.model
      .find({ projectId })
      .sort({ startAt: 1 })
      .lean()
      .exec()) as LeanEvent[];
    return rows.map(toOut);
  }

  async create(
    projectId: string,
    dto: CreateProjectCalendarEventDto,
  ): Promise<ProjectCalendarEventOutDto> {
    await assertProjectExists(projectId);
    const created = await ProjectCalendarEventRepo.create({
      projectId: new Types.ObjectId(projectId),
      type: dto.type,
      title: dto.title,
      notes: dto.notes ?? "",
      startAt: new Date(dto.startAt),
      endAt: dto.type === "range" && dto.endAt ? new Date(dto.endAt) : null,
    });
    return toOut(created as unknown as LeanEvent);
  }

  async update(
    projectId: string,
    eventId: string,
    dto: UpdateProjectCalendarEventDto,
  ): Promise<ProjectCalendarEventOutDto> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(eventId)) {
      throw new Error("Invalid event id");
    }

    const existing = (await ProjectCalendarEventRepo.model
      .findOne({ _id: eventId, projectId })
      .lean()
      .exec()) as LeanEvent | null;
    if (!existing) throw new Error("Event not found");

    const nextType = dto.type ?? existing.type;
    const nextStart = dto.startAt
      ? new Date(dto.startAt)
      : new Date(existing.startAt);
    let nextEnd: Date | null =
      dto.endAt !== undefined
        ? dto.endAt
          ? new Date(dto.endAt)
          : null
        : existing.endAt
          ? new Date(existing.endAt)
          : null;

    if (nextType === "deadline") {
      nextEnd = null;
    } else if (!nextEnd) {
      throw new Error("range requires endAt");
    } else if (nextEnd.getTime() < nextStart.getTime()) {
      throw new Error("endAt must be on or after startAt");
    }

    const updated = await ProjectCalendarEventRepo.findOneAndUpdate(
      { _id: eventId, projectId },
      {
        $set: {
          type: nextType,
          title: dto.title ?? existing.title,
          notes: dto.notes !== undefined ? dto.notes : (existing.notes ?? ""),
          startAt: nextStart,
          endAt: nextEnd,
        },
      },
    );
    if (!updated) throw new Error("Event not found");
    return toOut(updated as unknown as LeanEvent);
  }

  async remove(projectId: string, eventId: string): Promise<void> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(eventId)) {
      throw new Error("Invalid event id");
    }
    const deleted = await ProjectCalendarEventRepo.deleteOne({
      _id: eventId,
      projectId,
    });
    if (!deleted) throw new Error("Event not found");
  }

  async agenda(opts: {
    projectId?: string;
    nearDays: number;
  }): Promise<ProjectCalendarAgendaOutDto> {
    if (opts.projectId) {
      await assertProjectExists(opts.projectId);
    }

    const filter: Record<string, unknown> = {};
    if (opts.projectId) {
      filter.projectId = new Types.ObjectId(opts.projectId);
    }

    const rows = (await ProjectCalendarEventRepo.model
      .find(filter)
      .sort({ startAt: 1 })
      .lean()
      .exec()) as LeanEvent[];

    const todayYmd = jakartaYmdString(new Date());
    const dueUntilYmd = addJakartaDays(todayYmd, opts.nearDays);

    const today: ProjectCalendarEventOutDto[] = [];
    const upcoming: ProjectCalendarEventOutDto[] = [];
    const dueIn: ProjectCalendarEventOutDto[] = [];

    for (const row of rows) {
      const out = toOut(row);
      const startYmd = jakartaYmdString(new Date(row.startAt));
      const endYmd = row.endAt
        ? jakartaYmdString(new Date(row.endAt))
        : startYmd;

      const activeToday =
        row.type === "deadline"
          ? startYmd === todayYmd
          : startYmd <= todayYmd && todayYmd <= endYmd;

      if (activeToday) {
        today.push(out);
      }

      if (startYmd > todayYmd) {
        upcoming.push(out);
      }

      if (
        row.type === "deadline" &&
        startYmd >= todayYmd &&
        startYmd <= dueUntilYmd
      ) {
        dueIn.push(out);
      }
    }

    return {
      today,
      upcoming: upcoming.slice(0, 50),
      dueIn,
    };
  }
}

export const projectCalendarService = new ProjectCalendarService();
