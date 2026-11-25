/**
 * Decimal parsing/formatting for quantities and conversion factors.
 * Importing this module also applies the app-wide decimal.js settings.
 */
import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

const MAX_SIGNIFICANT = 18;
const MAX_FRACTIONAL = 8;

function assertDecimalShape(d: Decimal, field: string): void {
  if (!d.isFinite()) {
    throw new Error(`${field} must be a valid decimal`);
  }
  if (d.decimalPlaces() > MAX_FRACTIONAL) {
    throw new Error(
      `${field} may have at most ${MAX_FRACTIONAL} decimal places`,
    );
  }
  if (d.sd() > MAX_SIGNIFICANT) {
    throw new Error(
      `${field} may have at most ${MAX_SIGNIFICANT} significant digits`,
    );
  }
}

export function parsePositiveDecimal(
  raw: string,
  field = "conversionFactor",
): Decimal {
  let d: Decimal;
  try {
    d = new Decimal(raw.trim());
  } catch {
    throw new Error(`${field} must be a valid decimal`);
  }
  assertDecimalShape(d, field);
  if (d.lte(0)) {
    throw new Error(`${field} must be greater than 0`);
  }
  return d;
}

export function parseQtyDecimal(raw: string): Decimal {
  let d: Decimal;
  try {
    d = new Decimal(raw.trim());
  } catch {
    throw new Error("qty must be a valid decimal");
  }
  assertDecimalShape(d, "qty");
  if (d.isNeg()) {
    throw new Error("qty must not be negative");
  }
  return d;
}

export function formatDecimal(d: Decimal): string {
  return d.toDecimalPlaces(MAX_FRACTIONAL).toFixed();
}

/** done ÷ total as a whole percent, clamped 0–100 (0 when total ≤ 0). */
export function percentOf(done: string, total: string): number {
  const t = new Decimal(total);
  if (t.lte(0)) return 0;
  const p = new Decimal(done).div(t).times(100);
  return Math.min(100, Math.max(0, Math.round(p.toNumber())));
}
