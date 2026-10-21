import type { ProjectCalendarEventType } from "../models/projectCalendarEvent/projectCalendarEvent.model";

export type ProjectCalendarEventOutDto = {
  id: string;
  projectId: string;
  type: ProjectCalendarEventType;
  title: string;
  notes: string;
  startAt: string;
  endAt: string | null;
};

export type CreateProjectCalendarEventDto = {
  type: ProjectCalendarEventType;
  title: string;
  notes?: string;
  startAt: string;
  endAt?: string | null;
};

export type UpdateProjectCalendarEventDto = {
  type?: ProjectCalendarEventType;
  title?: string;
  notes?: string;
  startAt?: string;
  endAt?: string | null;
};

export type ProjectCalendarAgendaOutDto = {
  today: ProjectCalendarEventOutDto[];
  upcoming: ProjectCalendarEventOutDto[];
  dueIn: ProjectCalendarEventOutDto[];
};
