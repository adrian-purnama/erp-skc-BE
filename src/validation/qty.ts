import Decimal from "decimal.js";
import { formatDecimal } from "../utils/decimal";

/** Positive decimal qty, returned in canonical form. */
export function parsePositiveQty(raw: unknown, field = "qty"): string {
  const text = typeof raw === "number" ? String(raw) : raw;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error(`${field} is required`);
  }
  let d: Decimal;
  try {
    d = new Decimal(text.trim());
  } catch {
    throw new Error(`${field} must be a number`);
  }
  if (!d.isFinite() || d.lte(0)) {
    throw new Error(`${field} must be greater than 0`);
  }
  return formatDecimal(d);
}
