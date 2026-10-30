import Decimal from "decimal.js";
import type {
  PurchasePaymentStage,
  PurchasePaymentStatus,
  ReimburseItemStatus,
} from "../../models/purchasePayment.model";

/** Pure rules for purchase payments (no DB). */

function rupiah(d: Decimal): string {
  return d.toFixed(0);
}

/**
 * What the vendor of a PO is owed in all. Until the PO is fully received it is
 * the PO estimate (goods + estimated charges) less what staff bought themselves
 * (those are reimbursed); once fully received it is the actual vendor receipts.
 */
export function vendorPayable(input: {
  estimatedTotal: string;
  staffRealizedTotal: string;
  vendorRealizedTotal: string;
  fullyReceived: boolean;
}): { base: string; final: boolean } {
  if (input.fullyReceived) return { base: rupiah(new Decimal(input.vendorRealizedTotal)), final: true };
  const left = new Decimal(input.estimatedTotal).minus(input.staffRealizedTotal);
  return { base: rupiah(Decimal.max(left, 0)), final: false };
}

/** A percent stage priced on the payable, rounded half up like charges. */
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
  dp: "DP",
  termin: "Termin",
  pelunasan: "Pelunasan",
};

/**
 * Check one vendor stage against the PO's other live stages; returns the amount
 * to save. The pelunasan comes last, once the PO is fully received, and settles
 * whatever is left.
 */
export function checkVendorStage(input: {
  stage: PurchasePaymentStage;
  /** Priced amount for DP / termin; ignored for pelunasan. */
  amount: string;
  base: string;
  final: boolean;
  others: Array<{ stage: PurchasePaymentStage; amount: string }>;
}): { amount: string } {
  if (input.others.some((o) => o.stage === "pelunasan")) {
    throw new Error("This PO already has its pelunasan; no more payments can be added");
  }
  const othersTotal = input.others.reduce((sum, o) => sum.plus(o.amount), new Decimal(0));
  const left = new Decimal(input.base).minus(othersTotal);
  if (input.stage === "pelunasan") {
    if (!input.final) {
      throw new Error("Pelunasan is possible once everything on the PO is received (or the PO is closed)");
    }
    if (left.lte(0)) throw new Error("Nothing is left to pay on this PO");
    return { amount: rupiah(left) };
  }
  const amount = new Decimal(input.amount || 0);
  if (amount.lte(0)) throw new Error("Amount must be greater than 0");
  if (amount.gt(left)) {
    throw new Error(
      `Only Rp ${rupiah(Decimal.max(left, 0))} is left to pay on this PO (payable Rp ${input.base})`,
    );
  }
  return { amount: rupiah(amount) };
}

/** A reimbursement once its notas are decided: paid for the approved ones only. */
export function reimbursementOutcome(
  items: Array<{ status: ReimburseItemStatus; amount: string }>,
): { status: Extract<PurchasePaymentStatus, "pending_approval" | "approved" | "rejected">; amount: string } {
  const approved = items.filter((i) => i.status === "approved");
  const amount = rupiah(approved.reduce((sum, i) => sum.plus(i.amount), new Decimal(0)));
  if (items.some((i) => i.status === "pending")) return { status: "pending_approval", amount };
  return { status: approved.length > 0 ? "approved" : "rejected", amount };
}

/** Σ amounts, integer rupiah. */
export function sumAmounts(rows: Array<{ amount: string }>): string {
  return rupiah(rows.reduce((sum, r) => sum.plus(r.amount || 0), new Decimal(0)));
}
