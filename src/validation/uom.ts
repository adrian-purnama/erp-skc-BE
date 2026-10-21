import type { CreateUomDto, UpdateUomDto } from "../dto/uom.dto";
import { normalizeFormulas } from "../modules/uom/uomFormula";
import { asRecord } from "./asRecord";

function requireTrimmed(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${field} is required`);
  }
  return raw.trim();
}

export function parseCreateUomDto(body: unknown): CreateUomDto {
  const row = asRecord(body);
  return {
    symbol: requireTrimmed(row.symbol, "symbol"),
    category: requireTrimmed(row.category, "category"),
    name: requireTrimmed(row.name, "name"),
    formulas: normalizeFormulas(row.formulas),
  };
}

export function parseUpdateUomDto(body: unknown): UpdateUomDto {
  const row = asRecord(body);
  const patch: UpdateUomDto = {};

  if (row.symbol !== undefined) {
    patch.symbol = requireTrimmed(row.symbol, "symbol");
  }
  if (row.category !== undefined) {
    patch.category = requireTrimmed(row.category, "category");
  }
  if (row.name !== undefined) {
    patch.name = requireTrimmed(row.name, "name");
  }
  if (row.formulas !== undefined) {
    patch.formulas = normalizeFormulas(row.formulas);
  }
  if (row.isActive !== undefined) {
    if (typeof row.isActive !== "boolean") {
      throw new Error("isActive must be a boolean");
    }
    patch.isActive = row.isActive;
  }

  if (
    patch.symbol === undefined &&
    patch.category === undefined &&
    patch.name === undefined &&
    patch.formulas === undefined &&
    patch.isActive === undefined
  ) {
    throw new Error("No fields to update");
  }

  return patch;
}
