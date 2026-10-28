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
