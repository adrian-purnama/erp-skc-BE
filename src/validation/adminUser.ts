import type {
  CreateAdminUserDto,
  UpdateAdminUserDto,
} from "../dto/adminUser.dto";
import { normalizeEmail } from "../utils/email";
import { MIN_PASSWORD_LENGTH } from "./auth";

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

export function parseCreateAdminUserDto(body: unknown): CreateAdminUserDto {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }

  const raw = body as Record<string, unknown>;
  const email = normalizeEmail(raw.email);
  if (!email) {
    throw new Error("Invalid email");
  }

  if (typeof raw.password !== "string" || !raw.password) {
    throw new Error("password must be a non-empty string");
  }
  if (raw.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  if (raw.fullName !== undefined && typeof raw.fullName !== "string") {
    throw new Error("fullName must be a string");
  }

  if (
    raw.roles !== undefined &&
    (!Array.isArray(raw.roles) ||
      raw.roles.some((role) => typeof role !== "string"))
  ) {
    throw new Error("roles must be an array of strings");
  }
  const roles = ((raw.roles ?? []) as string[])
    .map((role) => role.trim())
    .filter(Boolean);

  return {
    email,
    password: raw.password,
    fullName: typeof raw.fullName === "string" ? raw.fullName.trim() : "",
    roles,
  };
}
