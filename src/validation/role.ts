import type { CreateRoleInput, UpdateRoleInput } from "../dto/role.dto";

const SLUG_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export class RoleValidationError extends Error {
  constructor(
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export function isRoleSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

export function parseCreateRoleDto(body: unknown): CreateRoleInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }
  const raw = body as Record<string, unknown>;

  if (typeof raw.key !== "string" || !raw.key.trim()) {
    throw new RoleValidationError("key is required", {
      key: "key is required",
    });
  }
  if (!isRoleSlug(raw.key.trim())) {
    throw new RoleValidationError("key must be a slug", {
      key: "key must be a slug (lowercase letters, numbers, underscores)",
    });
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    throw new RoleValidationError("name is required", {
      name: "name is required",
    });
  }

  return {
    key: raw.key.trim(),
    name: raw.name.trim(),
    description:
      typeof raw.description === "string" ? raw.description.trim() : "",
    permissions: parseStringArray(raw.permissions, "permissions"),
    includes: parseStringArray(raw.includes, "includes"),
  };
}

export function parseUpdateRoleDto(body: unknown): UpdateRoleInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }
  const raw = body as Record<string, unknown>;
  const patch: UpdateRoleInput = {};
  const fields: Record<string, string> = {};

  if ("name" in raw) {
    if (typeof raw.name !== "string" || !raw.name.trim()) {
      fields.name = "name must be a non-empty string";
    } else {
      patch.name = raw.name.trim();
    }
  }
  if ("description" in raw) {
    if (typeof raw.description !== "string") {
      fields.description = "description must be a string";
    } else {
      patch.description = raw.description.trim();
    }
  }
  if ("permissions" in raw) {
    try {
      patch.permissions = parseStringArray(raw.permissions, "permissions");
    } catch (error) {
      fields.permissions =
        error instanceof Error ? error.message : "invalid permissions";
    }
  }
  if ("includes" in raw) {
    try {
      patch.includes = parseStringArray(raw.includes, "includes");
    } catch (error) {
      fields.includes =
        error instanceof Error ? error.message : "invalid includes";
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new RoleValidationError("Validation failed", fields);
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("No valid fields to update");
  }
  return patch;
}

export function parseUserRolesDto(body: unknown): string[] {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }
  const raw = body as Record<string, unknown>;
  return parseStringArray(raw.roles, "roles");
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value.map((v) => v.trim()).filter(Boolean);
}
