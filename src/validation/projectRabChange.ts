import type { OpenProjectRabChangeInDto } from "../dto/projectRabChange.dto";
import { asRecord } from "./asRecord";

export function parseOpenProjectRabChangeDto(
  body: unknown,
): OpenProjectRabChangeInDto {
  const row = asRecord(body);
  if (typeof row.reason !== "string" || !row.reason.trim()) {
    throw new Error("reason is required");
  }
  return { reason: row.reason.trim() };
}
