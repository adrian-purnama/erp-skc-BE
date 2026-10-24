import type {
  CreateTermOfPaymentDto,
  UpdateTermOfPaymentDto,
} from "../dto/termOfPayment.dto";
import { asRecord } from "./asRecord";

function requireTrimmed(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${field} is required`);
  }
  return raw.trim();
}

export function parseCreateTermOfPaymentDto(
  body: unknown,
): CreateTermOfPaymentDto {
  const row = asRecord(body);
  return {
    termOfPayment: requireTrimmed(row.termOfPayment, "termOfPayment"),
  };
}

export function parseUpdateTermOfPaymentDto(
  body: unknown,
): UpdateTermOfPaymentDto {
  const row = asRecord(body);
  const patch: UpdateTermOfPaymentDto = {};

  if (row.termOfPayment !== undefined) {
    patch.termOfPayment = requireTrimmed(row.termOfPayment, "termOfPayment");
  }
  if (row.isActive !== undefined) {
    if (typeof row.isActive !== "boolean") {
      throw new Error("isActive must be a boolean");
    }
    patch.isActive = row.isActive;
  }

  if (patch.termOfPayment === undefined && patch.isActive === undefined) {
    throw new Error("No fields to update");
  }

  return patch;
}
