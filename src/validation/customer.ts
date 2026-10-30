import {
  EMAIL_TYPES,
  type EmailType,
} from "../models/email.model";
import {
  PHONE_TYPES,
  type PhoneType,
} from "../models/phone.model";
import type {
  CreateCustomerDto,
  CustomerEmailInDto,
  CustomerPhoneInDto,
  UpdateCustomerDto,
} from "../dto/customer.dto";
import { asRecord } from "./asRecord";

function parseEmailRow(raw: unknown, index: number): CustomerEmailInDto {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`emails[${index}] is invalid`);
  }
  const row = raw as Record<string, unknown>;
  const address = typeof row.address === "string" ? row.address.trim() : "";
  if (!address) throw new Error(`emails[${index}].address is required`);
  const type = row.type;
  if (typeof type !== "string" || !EMAIL_TYPES.includes(type as EmailType)) {
    throw new Error(`emails[${index}].type is invalid`);
  }
  const result: CustomerEmailInDto = {
    address,
    type: type as EmailType,
    isPreferred: Boolean(row.isPreferred),
  };
  if (typeof row.id === "string" && row.id.trim()) {
    result.id = row.id.trim();
  }
  return result;
}

function parsePhoneRow(raw: unknown, index: number): CustomerPhoneInDto {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`phones[${index}] is invalid`);
  }
  const row = raw as Record<string, unknown>;
  const number = typeof row.number === "string" ? row.number.trim() : "";
  if (!number) throw new Error(`phones[${index}].number is required`);
  const type = row.type;
  if (typeof type !== "string" || !PHONE_TYPES.includes(type as PhoneType)) {
    throw new Error(`phones[${index}].type is invalid`);
  }
  const result: CustomerPhoneInDto = {
    number,
    type: type as PhoneType,
    isPreferred: Boolean(row.isPreferred),
  };
  if (typeof row.id === "string" && row.id.trim()) {
    result.id = row.id.trim();
  }
  return result;
}

function parseEmails(raw: unknown): CustomerEmailInDto[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error("emails must be an array");
  return raw.map(parseEmailRow);
}

function parsePhones(raw: unknown): CustomerPhoneInDto[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error("phones must be an array");
  return raw.map(parsePhoneRow);
}

/** Exactly 16 digits after stripping non-digit separators. */
function parseNpwp(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("npwp must be 16 digits");
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 16) throw new Error("npwp must be 16 digits");
  return digits;
}

export function parseCreateCustomerDto(body: unknown): CreateCustomerDto {
  const row = asRecord(body);
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) throw new Error("name is required");
  const address = typeof row.address === "string" ? row.address.trim() : "";
  const npwp = parseNpwp(row.npwp);
  return {
    name,
    address,
    npwp,
    emails: parseEmails(row.emails) ?? [],
    phones: parsePhones(row.phones) ?? [],
  };
}

export function parseUpdateCustomerDto(body: unknown): UpdateCustomerDto {
  const row = asRecord(body);
  const patch: UpdateCustomerDto = {};
  if (row.name !== undefined) {
    if (typeof row.name !== "string" || !row.name.trim()) {
      throw new Error("name is required");
    }
    patch.name = row.name.trim();
  }
  if (row.address !== undefined) {
    if (typeof row.address !== "string") {
      throw new Error("address must be a string");
    }
    patch.address = row.address.trim();
  }
  if (row.npwp !== undefined) {
    patch.npwp = parseNpwp(row.npwp);
  }
  if (row.emails !== undefined) {
    patch.emails = parseEmails(row.emails);
  }
  if (row.phones !== undefined) {
    patch.phones = parsePhones(row.phones);
  }
  if (row.isActive !== undefined) {
    if (typeof row.isActive !== "boolean") {
      throw new Error("isActive must be a boolean");
    }
    patch.isActive = row.isActive;
  }
  if (
    patch.name === undefined &&
    patch.address === undefined &&
    patch.npwp === undefined &&
    patch.isActive === undefined &&
    patch.emails === undefined &&
    patch.phones === undefined
  ) {
    throw new Error("No fields to update");
  }
  return patch;
}
