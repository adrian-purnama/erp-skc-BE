import Decimal from "decimal.js";
import type { PurchasePaymentStage } from "../../models/purchasePayment.model";

/** Pure rules for purchase payments (no DB). */

function rupiah(d: Decimal): string {
  return d.toFixed(0);
}

/** A percent payment priced on what the payee is owed, rounded half up like charges. */
export function priceStage(input: {
  basis: "percent" | "fixed";
  rate: string | null;
  amount: string;
  base: string;
}): string {
  if (input.basis === "fixed") return rupiah(new Decimal(input.amount || 0));
  return new Decimal(input.base)
    .times(input.rate ?? 0)
    .div(100)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toFixed(0);
}

export const STAGE_LABELS: Record<PurchasePaymentStage, string> = {
  partial: "Partial",
  full: "Full",
};

/**
 * Check one payment against the payee's other live payments on the PO; returns
 * the amount to save. Partial pays part of what is left; full pays all of it.
 * A full payment does not lock the PO: if more is owed later (e.g. the GR came
 * in above the estimate), the difference can be paid too.
 */
export function checkPaymentAmount(input: {
  stage: PurchasePaymentStage;
  /** Priced amount for partial; ignored for full. */
  amount: string;
  /** What the payee is owed on the PO in all. */
  owed: string;
  others: Array<{ amount: string }>;
}): { amount: string } {
  const left = new Decimal(input.owed).minus(sumAmounts(input.others));
  if (left.lte(0)) throw new Error("Nothing is left to pay to this payee on the PO");
  if (input.stage === "full") return { amount: rupiah(left) };
  const amount = new Decimal(input.amount || 0);
  if (amount.lte(0)) throw new Error("Amount must be greater than 0");
  if (amount.gt(left)) {
    throw new Error(`Only Rp ${rupiah(left)} is left to pay to this payee (owed Rp ${input.owed})`);
  }
  return { amount: rupiah(amount) };
}

/** Σ amounts, integer rupiah. */
export function sumAmounts(rows: Array<{ amount: string }>): string {
  return rupiah(rows.reduce((sum, r) => sum.plus(r.amount || 0), new Decimal(0)));
}
