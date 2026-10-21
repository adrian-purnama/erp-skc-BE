import { Types } from "mongoose";
import type {
  PurgeOrphanBlobsInDto,
  StartShrinkDbInDto,
} from "../dto/shrinkDb.dto";
import { SHRINK_SECTIONS } from "../models/shrinkRun/shrinkRun.model";

export function parseStartShrinkDbDto(body: unknown): StartShrinkDbInDto {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }
  const raw = body as Record<string, unknown>;

  if (typeof raw.section !== "string") {
    throw new Error("section is required");
  }
  if (!(SHRINK_SECTIONS as readonly string[]).includes(raw.section)) {
    throw new Error('section must be "audit" or "documents"');
  }
  const section = raw.section as StartShrinkDbInDto["section"];

  const list = raw.excludedProjectIds;
  if (list === undefined) {
    return { section, excludedProjectIds: [] };
  }
  if (!Array.isArray(list) || list.some((id) => typeof id !== "string")) {
    throw new Error("excludedProjectIds must be an array of strings");
  }
  const excludedProjectIds = list.map((id) => id.trim()).filter(Boolean);
  for (const id of excludedProjectIds) {
    if (!Types.ObjectId.isValid(id)) {
      throw new Error(`Invalid project id: ${id}`);
    }
  }
  return {
    section,
    excludedProjectIds: [...new Set(excludedProjectIds)],
  };
}

export function parsePurgeOrphanBlobsDto(body: unknown): PurgeOrphanBlobsInDto {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }
  const raw = body as Record<string, unknown>;
  if (
    !Array.isArray(raw.gridFsIds) ||
    raw.gridFsIds.some((id) => typeof id !== "string")
  ) {
    throw new Error("gridFsIds must be an array of strings");
  }
  const gridFsIds = raw.gridFsIds.map((id) => id.trim()).filter(Boolean);
  for (const id of gridFsIds) {
    if (!Types.ObjectId.isValid(id)) {
      throw new Error(`Invalid gridFs id: ${id}`);
    }
  }
  return { gridFsIds: [...new Set(gridFsIds)] };
}
