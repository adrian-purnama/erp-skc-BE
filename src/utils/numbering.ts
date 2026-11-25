import { jakartaYmdParts } from "./time";

/**
 * The period part shared by every document number (PRJ, SPK, PO, …):
 * documents are numbered per Jakarta calendar month, e.g. `…/XI/2026/0001`.
 */
export type NumberingPeriod = {
  year: number;
  month: number;
  /** Roman month, I..XII. */
  roman: string;
  /** Counter scope, `YYYY-MM`. */
  scopeKey: string;
};

const ROMAN_MONTHS = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
] as const;

export function toRomanMonth(month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("month must be an integer from 1 to 12");
  }
  return ROMAN_MONTHS[month - 1];
}

export function numberingPeriod(now: Date = new Date()): NumberingPeriod {
  const { year, month } = jakartaYmdParts(now);
  return {
    year,
    month,
    roman: toRomanMonth(month),
    scopeKey: `${year}-${String(month).padStart(2, "0")}`,
  };
}
