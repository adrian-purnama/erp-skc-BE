import type { RealizationChargeInDto } from "../dto/charge.dto";
import { CHARGE_CATEGORIES, inferChargeCategory, type ChargeCategory } from "../utils/charges";
import { asRecord } from "./asRecord";
import { parsePositiveQty } from "./qty";

const CHARGES_MAX = 20;

function parseText(raw: unknown, field: string, max: number): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") throw new Error(`${field} must be text`);
  const text = raw.trim();
  if (text.length > max) {
    throw new Error(`${field} must be at most ${max} characters`);
  }
  return text;
}

/** Whole rupiah (non-negative integer), returned without leading zeros. */
export function parseRupiah(raw: unknown, field: string): string {
  const text = typeof raw === "number" ? String(raw) : raw;
  if (typeof text !== "string" || !/^\d+$/.test(text.trim())) {
    throw new Error(`${field} must be a whole rupiah amount`);
  }
  return String(BigInt(text.trim()));
}

/** Tax / delivery / other charges (realization, PO estimate, RAB budget); absent = none. */
export function parseChargeList(raw: unknown): RealizationChargeInDto[] {
  const charges = raw ?? [];
  if (!Array.isArray(charges)) throw new Error("charges must be a list");
  if (charges.length > CHARGES_MAX) throw new Error(`At most ${CHARGES_MAX} charges`);
  return charges.map(parseRealizationCharge);
}

function parseRealizationCharge(raw: unknown, index: number): RealizationChargeInDto {
  const row = asRecord(raw);
  const at = `charges[${index}]`;
  const label = parseText(row.label, `${at}.label`, 100);
  if (!label) throw new Error(`${at}.label is required`);
  // Older clients send no category: take it from the name.
  let category = inferChargeCategory(label);
  if (row.category !== undefined && row.category !== null && row.category !== "") {
    if (!(CHARGE_CATEGORIES as readonly unknown[]).includes(row.category)) {
      throw new Error(`${at}.category must be one of: ${CHARGE_CATEGORIES.join(", ")}`);
    }
    category = row.category as ChargeCategory;
  }
  if (row.kind === "percent") {
    const rate = parsePositiveQty(row.rate, `${at}.rate`);
    if (Number(rate) > 100) throw new Error(`${at}.rate must be at most 100`);
    return { category, label, kind: "percent", rate, amount: "0" };
  }
  if (row.kind === "fixed") {
    return { category, label, kind: "fixed", rate: null, amount: parseRupiah(row.amount, `${at}.amount`) };
  }
  throw new Error(`${at}.kind must be percent or fixed`);
}
