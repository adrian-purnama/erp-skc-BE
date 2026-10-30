import Decimal from "decimal.js";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { lineAmount } from "./purchaseOrder.planner";

/** Pure rules for Nota Realisasi lines (no DB). */

export type RealizationLineInput = {
  poLineId: string;
  qty: string;
  /** Actual integer rupiah per unit. */
  unitPrice: string;
  note: string;
};

/** The approved PO line a realization line buys. */
export type PoLineRef = {
  poLineId: string;
  label: string;
  qty: string;
  /** Approved integer rupiah per unit. */
  unitPrice: string;
};

export type CheckedRealizationLine = RealizationLineInput & {
  amount: string;
  /** amount − qty × approved price; positive = paid more. */
  difference: string;
};

export type RealizationStatus = "none" | "partial" | "full";

/** Σ qty per PO line over the given realization lines. */
export function sumRealized(
  lines: Array<{ poLineId: string; qty: string }>,
): Map<string, Decimal> {
  const sums = new Map<string, Decimal>();
  for (const l of lines) {
    sums.set(l.poLineId, (sums.get(l.poLineId) ?? new Decimal(0)).plus(l.qty));
  }
  return sums;
}

export function remainingToRealize(ordered: string, realized: Decimal | undefined): Decimal {
  const left = new Decimal(ordered).minus(realized ?? 0);
  return left.isNeg() ? new Decimal(0) : left;
}

/** PO-level progress from its lines. */
export function realizationStatus(
  lines: Array<{ qty: string; realized: Decimal | undefined }>,
): RealizationStatus {
  if (lines.every((l) => (l.realized ?? new Decimal(0)).lte(0))) return "none";
  return lines.every((l) => (l.realized ?? new Decimal(0)).gte(l.qty)) ? "full" : "partial";
}

/**
 * Validate realization lines against the approved PO. `realizedElsewhere` is
 * what other live (draft / posted) realizations already hold per PO line.
 */
export function checkRealizationLines(input: {
  lines: RealizationLineInput[];
  poLines: Map<string, PoLineRef>;
  realizedElsewhere: Map<string, Decimal>;
}): { lines: CheckedRealizationLine[]; total: string; difference: string } {
  if (input.lines.length === 0) throw new Error("Add at least one item");
  const seen = new Set<string>();
  let total = new Decimal(0);
  let difference = new Decimal(0);
  const lines = input.lines.map((line) => {
    const ref = input.poLines.get(line.poLineId);
    if (!ref) throw new Error("A line is not on this PO");
    if (seen.has(line.poLineId)) throw new Error(`${ref.label} is listed twice`);
    seen.add(line.poLineId);
    const qty = new Decimal(line.qty);
    if (qty.lte(0)) throw new Error(`${ref.label}: qty must be greater than 0`);
    const left = remainingToRealize(ref.qty, input.realizedElsewhere.get(line.poLineId));
    if (qty.gt(left)) {
      throw new Error(
        `${ref.label}: only ${formatDecimal(left)} left of the ${formatDecimal(new Decimal(ref.qty))} approved on the PO`,
      );
    }
    if (new Decimal(line.unitPrice).lte(0)) throw new Error(`${ref.label}: enter the actual price`);
    const amount = lineAmount(line.qty, line.unitPrice);
    const diff = amount.minus(lineAmount(line.qty, ref.unitPrice));
    total = total.plus(amount);
    difference = difference.plus(diff);
    return { ...line, note: line.note.trim(), amount: amount.toFixed(0), difference: diff.toFixed(0) };
  });
  return { lines, total: total.toFixed(0), difference: difference.toFixed(0) };
}

/** Spending buckets for costs on top of the goods. */
export const CHARGE_CATEGORIES = ["tax", "delivery", "other"] as const;
export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

const TAX_WORDS = /\b(ppn|pph|pajak|tax|vat)\b/i;
const DELIVERY_WORDS = /\b(ongkir|ongkos|kirim|pengiriman|delivery|shipping|ekspedisi|transport|freight)\b/i;

/** Category for charges saved before categories existed, from their name. */
export function inferChargeCategory(label: string): ChargeCategory {
  if (TAX_WORDS.test(label)) return "tax";
  if (DELIVERY_WORDS.test(label)) return "delivery";
  return "other";
}

export type ChargeTotals = Record<ChargeCategory, string>;

/** Σ charge amount per category (integer rupiah; "0" when none). */
export function chargesByCategory(
  charges: Array<{ category?: ChargeCategory | null; label: string; amount: string }>,
): ChargeTotals {
  const sums: Record<ChargeCategory, Decimal> = {
    tax: new Decimal(0),
    delivery: new Decimal(0),
    other: new Decimal(0),
  };
  for (const c of charges) {
    const category = c.category ?? inferChargeCategory(c.label);
    sums[category] = sums[category].plus(c.amount || 0);
  }
  return {
    tax: sums.tax.toFixed(0),
    delivery: sums.delivery.toFixed(0),
    other: sums.other.toFixed(0),
  };
}

/**
 * Stored charges priced against a (possibly changed) goods subtotal, for
 * display: percent charges follow the subtotal, missing categories are inferred.
 */
export function priceStoredCharges<T extends {
  _id?: unknown;
  category?: ChargeCategory | null;
  label: string;
  kind: "percent" | "fixed";
  rate?: string | null;
  amount: string;
}>(
  subtotal: string,
  charges: T[],
): {
  charges: Array<RealizationChargeInput & { id: string }>;
  byCategory: ChargeTotals;
  chargesTotal: string;
  total: string;
} {
  let chargesTotal = new Decimal(0);
  const out = charges.map((c) => {
    const amount =
      c.kind === "percent"
        ? new Decimal(subtotal || 0)
            .times(c.rate ?? 0)
            .div(100)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        : new Decimal(c.amount || 0);
    chargesTotal = chargesTotal.plus(amount);
    return {
      id: String(c._id ?? ""),
      category: c.category ?? inferChargeCategory(c.label),
      label: c.label,
      kind: c.kind,
      rate: c.kind === "percent" ? (c.rate ?? null) : null,
      amount: amount.toFixed(0),
    };
  });
  return {
    charges: out,
    byCategory: chargesByCategory(out),
    chargesTotal: chargesTotal.toFixed(0),
    total: new Decimal(subtotal || 0).plus(chargesTotal).toFixed(0),
  };
}

export type RealizationChargeInput = {
  category: ChargeCategory;
  label: string;
  kind: "percent" | "fixed";
  /** Percent of the subtotal; required for `percent`. */
  rate: string | null;
  /** Integer rupiah; used for `fixed`, recomputed for `percent`. */
  amount: string;
};

/**
 * Price the extra charges (PPN, ongkir, …) on top of the goods subtotal.
 * Percent charges are always recomputed from the subtotal (rounded half up
 * to whole rupiah) so they follow line edits.
 */
export function checkRealizationCharges(
  subtotal: string,
  charges: RealizationChargeInput[],
): { charges: RealizationChargeInput[]; chargesTotal: string; total: string } {
  let chargesTotal = new Decimal(0);
  const out = charges.map((c) => {
    const label = c.label.trim();
    if (!label) throw new Error("Each charge needs a name");
    let amount: Decimal;
    if (c.kind === "percent") {
      const rate = new Decimal(c.rate ?? "0");
      if (rate.lte(0) || rate.gt(100)) throw new Error(`${label}: rate must be between 0 and 100`);
      amount = new Decimal(subtotal).times(rate).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    } else {
      amount = new Decimal(c.amount);
      if (amount.lte(0) || !amount.isInteger()) {
        throw new Error(`${label}: enter a whole rupiah amount above 0`);
      }
    }
    chargesTotal = chargesTotal.plus(amount);
    return {
      category: c.category,
      label,
      kind: c.kind,
      rate: c.kind === "percent" ? formatDecimal(new Decimal(c.rate ?? "0")) : null,
      amount: amount.toFixed(0),
    };
  });
  return {
    charges: out,
    chargesTotal: chargesTotal.toFixed(0),
    total: new Decimal(subtotal).plus(chargesTotal).toFixed(0),
  };
}
