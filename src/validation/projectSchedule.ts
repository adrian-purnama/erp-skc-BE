import { Types } from "mongoose";
import {
  S_CURVE_PERIODS,
  type SaveProjectScheduleDto,
  type SCurvePeriod,
} from "../dto/projectSchedule.dto";
import { asRecord } from "./asRecord";
import { parseYmdDate } from "./itemMaster";

function optionalYmd(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  return parseYmdDate(raw, field);
}

/** Both dates or neither; start on or before finish. */
export function parseYmdPair(
  start: unknown,
  finish: unknown,
  label: string,
): [string | null, string | null] {
  const s = optionalYmd(start, `${label} start`);
  const f = optionalYmd(finish, `${label} finish`);
  if ((s === null) !== (f === null)) {
    throw new Error(`${label}: set both start and finish, or neither`);
  }
  if (s && f && f < s) throw new Error(`${label}: finish is before start`);
  return [s, f];
}

export function parseSaveProjectScheduleDto(body: unknown): SaveProjectScheduleDto {
  const row = asRecord(body);
  const [plannedStartDate, plannedFinishDate] = parseYmdPair(
    row.plannedStartDate,
    row.plannedFinishDate,
    "Project",
  );
  if (!Array.isArray(row.items)) throw new Error("items must be an array");
  const seen = new Set<string>();
  const items = row.items.map((raw, idx) => {
    const it = asRecord(raw);
    const itemId = typeof it.itemId === "string" ? it.itemId.trim() : "";
    if (!Types.ObjectId.isValid(itemId)) throw new Error(`items[${idx}].itemId is invalid`);
    if (seen.has(itemId)) throw new Error("An item appears twice in the schedule");
    seen.add(itemId);
    const [makeStart, makeFinish] = parseYmdPair(it.makeStart, it.makeFinish, `Item ${idx + 1} making`);
    const [installStart, installFinish] = parseYmdPair(
      it.installStart,
      it.installFinish,
      `Item ${idx + 1} install`,
    );
    return { itemId, makeStart, makeFinish, installStart, installFinish };
  });
  return { plannedStartDate, plannedFinishDate, items };
}

export function parseSCurvePeriod(raw: unknown): SCurvePeriod {
  if (raw === undefined || raw === null || raw === "") return "week";
  if (typeof raw !== "string" || !S_CURVE_PERIODS.includes(raw as SCurvePeriod)) {
    throw new Error("period must be week or day");
  }
  return raw as SCurvePeriod;
}
