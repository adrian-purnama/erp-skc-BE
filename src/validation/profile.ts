import type { UpdateProfileInDto } from "../dto/profile.dto";
import { asRecord } from "./asRecord";

export function parseUpdateProfileDto(body: unknown): UpdateProfileInDto {
  const row = asRecord(body);
  const fullName =
    typeof row.fullName === "string" ? row.fullName.trim() : "";

  if (fullName.length > 120) {
    throw new Error("Full name must be at most 120 characters");
  }

  return { fullName };
}
