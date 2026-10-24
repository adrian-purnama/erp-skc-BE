import type { UpdateAdminUserDto } from "../dto/adminUser.dto";

const MIN_PASSWORD_LENGTH = 8;

export function parseUpdateAdminUserDto(body: unknown): UpdateAdminUserDto {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }

  const raw = body as Record<string, unknown>;
  const patch: UpdateAdminUserDto = {};

  if ("password" in raw) {
    if (typeof raw.password !== "string" || !raw.password) {
      throw new Error("password must be a non-empty string");
    }
    if (raw.password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    patch.password = raw.password;
  }

  if ("isBlocked" in raw) {
    if (typeof raw.isBlocked !== "boolean") {
      throw new Error("isBlocked must be a boolean");
    }
    patch.isBlocked = raw.isBlocked;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("No valid fields to update");
  }

  return patch;
}
