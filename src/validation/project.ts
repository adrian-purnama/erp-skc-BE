import { Types } from "mongoose";
import type {
  CreateProjectDto,
  ProjectCustomerContactDto,
  UpdateProjectDto,
} from "../dto/project.dto";
import {
  PROJECT_CLOSE_REASONS,
  PROJECT_GENDERS,
  PROJECT_LOSE_REASONS,
  PROJECT_STATUSES,
  type ProjectCloseReason,
  type ProjectGender,
  type ProjectLoseReason,
  type ProjectStatus,
} from "../models/project.model";
import { asRecord } from "./asRecord";

function parseContactMap(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("customerContact.contact must be an object");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim();
    if (!k) throw new Error("customerContact.contact keys must be non-empty");
    if (typeof value !== "string") {
      throw new Error(`customerContact.contact.${k} must be a string`);
    }
    out[k] = value.trim();
  }
  return out;
}

export function parseCustomerContact(
  raw: unknown,
): ProjectCustomerContactDto {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("customerContact is required");
  }
  const row = raw as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) throw new Error("customerContact.name is required");
  const gender = row.gender;
  if (
    typeof gender !== "string" ||
    !PROJECT_GENDERS.includes(gender as ProjectGender)
  ) {
    throw new Error("customerContact.gender must be male or female");
  }
  return {
    name,
    gender: gender as ProjectGender,
    contact: parseContactMap(row.contact),
  };
}

function parseCustomerId(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("customerId is required");
  }
  const id = raw.trim();
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid customerId");
  return id;
}

function parseStatus(raw: unknown): ProjectStatus {
  if (
    typeof raw !== "string" ||
    !PROJECT_STATUSES.includes(raw as ProjectStatus)
  ) {
    throw new Error("status must be open, win, lose, close, or completed");
  }
  return raw as ProjectStatus;
}

function parseLoseReason(raw: unknown): ProjectLoseReason {
  if (
    typeof raw !== "string" ||
    !PROJECT_LOSE_REASONS.includes(raw as ProjectLoseReason)
  ) {
    throw new Error("loseReason is invalid");
  }
  return raw as ProjectLoseReason;
}

function parseCloseReason(raw: unknown): ProjectCloseReason {
  if (
    typeof raw !== "string" ||
    !PROJECT_CLOSE_REASONS.includes(raw as ProjectCloseReason)
  ) {
    throw new Error("closeReason is invalid");
  }
  return raw as ProjectCloseReason;
}

/** Normalize status + reason fields for create/update. */
export function resolveStatusFields(input: {
  status: ProjectStatus;
  loseReason?: unknown;
  closeReason?: unknown;
}): {
  status: ProjectStatus;
  loseReason: ProjectLoseReason | null;
  closeReason: ProjectCloseReason | null;
} {
  const { status } = input;
  if (status === "lose") {
    if (input.loseReason === undefined || input.loseReason === null) {
      throw new Error("loseReason is required when status is lose");
    }
    return {
      status,
      loseReason: parseLoseReason(input.loseReason),
      closeReason: null,
    };
  }
  if (status === "close") {
    if (input.closeReason === undefined || input.closeReason === null) {
      throw new Error("closeReason is required when status is close");
    }
    return {
      status,
      loseReason: null,
      closeReason: parseCloseReason(input.closeReason),
    };
  }
  return { status, loseReason: null, closeReason: null };
}

export function parseCreateProjectDto(body: unknown): CreateProjectDto {
  const row = asRecord(body);
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) throw new Error("name is required");
  const description =
    typeof row.description === "string" ? row.description.trim() : "";
  const status =
    row.status === undefined ? ("open" as const) : parseStatus(row.status);
  const statusFields = resolveStatusFields({
    status,
    loseReason: row.loseReason,
    closeReason: row.closeReason,
  });
  return {
    name,
    description,
    customerId: parseCustomerId(row.customerId),
    customerContact: parseCustomerContact(row.customerContact),
    ...statusFields,
  };
}

export function parseUpdateProjectDto(body: unknown): UpdateProjectDto {
  const row = asRecord(body);
  const patch: UpdateProjectDto = {};

  if (row.name !== undefined) {
    if (typeof row.name !== "string" || !row.name.trim()) {
      throw new Error("name is required");
    }
    patch.name = row.name.trim();
  }
  if (row.description !== undefined) {
    if (typeof row.description !== "string") {
      throw new Error("description must be a string");
    }
    patch.description = row.description.trim();
  }
  if (row.customerId !== undefined) {
    patch.customerId = parseCustomerId(row.customerId);
  }
  if (row.customerContact !== undefined) {
    patch.customerContact = parseCustomerContact(row.customerContact);
  }
  if (row.isActive !== undefined) {
    if (typeof row.isActive !== "boolean") {
      throw new Error("isActive must be a boolean");
    }
    patch.isActive = row.isActive;
  }

  if (
    row.status !== undefined ||
    row.loseReason !== undefined ||
    row.closeReason !== undefined
  ) {
    if (row.status === undefined) {
      throw new Error("status is required when updating loseReason or closeReason");
    }
    const statusFields = resolveStatusFields({
      status: parseStatus(row.status),
      loseReason: row.loseReason,
      closeReason: row.closeReason,
    });
    patch.status = statusFields.status;
    patch.loseReason = statusFields.loseReason;
    patch.closeReason = statusFields.closeReason;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("No fields to update");
  }
  return patch;
}
