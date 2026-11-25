import Decimal from "decimal.js";
import { lineAmount } from "./purchaseOrder.planner";
import { priceStoredCharges, type ChargeCategory } from "../../utils/charges";

/**
 * Pure money rule for vendor purchases (no DB). Vendor receipts (GR) carry no
 * typed money: an invoiced GR is worth what its invoice says, any other GR is
 * worth the PO price plus its share of the PO charges, and goods not yet
 * received are still owed at the PO price.
 */

export type MoneyCharge = {
  category: ChargeCategory;
  label: string;
  kind: "percent" | "fixed";
  rate: string | null;
  amount: string;
};

type StoredCharge = {
  category?: ChargeCategory | null;
  label: string;
  kind: "percent" | "fixed";
  rate?: string | null;
  amount: string;
};

export type PoLineMoney = { id: string; qty: string; unitPrice: string };

/** A posted realization of the PO (vendor GR or staff NR), in posting order. */
export type ReceiptMoney = {
  id: string;
  method: "vendor" | "staff";
  lines: Array<{ id: string; poLineId: string; qty: string }>;
  /** Vendor GR: its posted invoice, if any. */
  invoiceId: string | null;
};

/** A posted vendor invoice: actual price per GR line, and charges for all its GRs. */
export type InvoiceMoney = {
  id: string;
  realizationIds: string[];
  lines: Array<{ realizationLineId: string; unitPrice: string }>;
  charges: StoredCharge[];
};

export type PricedReceipt = {
  invoiced: boolean;
  lines: Array<{ id: string; unitPrice: string }>;
  charges: MoneyCharge[];
  subtotal: string;
  chargesTotal: string;
  total: string;
};

/**
 * Split `total` over slices by weight, rounding cumulatively so the shares add
 * up exactly to `total × Σweights / whole` (all of it when the slices cover the whole).
 */
export function shareByWeight(total: string, weights: Decimal[], whole: Decimal): string[] {
  if (whole.lte(0)) return weights.map(() => "0");
  let cum = new Decimal(0);
  let before = new Decimal(0);
  return weights.map((w) => {
    cum = cum.plus(w);
    const upTo = new Decimal(total).times(Decimal.min(cum, whole)).div(whole).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const share = upTo.minus(before);
    before = upTo;
    return share.toFixed(0);
  });
}

/** Each charge's whole amount shared over slices of goods; zero shares dropped. */
function shareCharges(charges: MoneyCharge[], weights: Decimal[], whole: Decimal): MoneyCharge[][] {
  const perSlice: MoneyCharge[][] = weights.map(() => []);
  for (const c of charges) {
    shareByWeight(c.amount, weights, whole).forEach((amount, i) => {
      if (amount !== "0") perSlice[i]!.push({ ...c, amount });
    });
  }
  return perSlice;
}

function priced(subtotal: Decimal, charges: MoneyCharge[]) {
  const chargesTotal = charges.reduce((s, c) => s.plus(c.amount), new Decimal(0));
  return {
    subtotal: subtotal.toFixed(0),
    chargesTotal: chargesTotal.toFixed(0),
    total: subtotal.plus(chargesTotal).toFixed(0),
  };
}

/**
 * What every posted vendor GR of a PO is worth, what is still owed for goods
 * not yet received (vendor or staff), and so what the vendor is owed in all.
 */
export function priceVendorReceipts(input: {
  poLines: PoLineMoney[];
  poCharges: StoredCharge[];
  closedPartial: boolean;
  receipts: ReceiptMoney[];
  invoices: InvoiceMoney[];
}): { receipts: Map<string, PricedReceipt>; notYetReceived: string; vendorOwed: string } {
  const poPrice = new Map(input.poLines.map((l) => [l.id, l.unitPrice]));
  const poGoods = input.poLines.reduce((s, l) => s.plus(lineAmount(l.qty, l.unitPrice)), new Decimal(0));
  const poCharges = priceStoredCharges(poGoods.toFixed(0), input.poCharges);
  const goodsAtPo = (r: ReceiptMoney) =>
    r.lines.reduce((s, l) => s.plus(lineAmount(l.qty, poPrice.get(l.poLineId) ?? "0")), new Decimal(0));

  // Everything received (vendor and staff), valued at the PO, in posting order.
  const receivedWeights = input.receipts.map(goodsAtPo);
  const provisional = shareCharges(poCharges.charges, receivedWeights, poGoods);
  const receivedAtPo = input.receipts.reduce(
    (s, _r, i) => s.plus(receivedWeights[i]!).plus(priced(new Decimal(0), provisional[i]!).chargesTotal),
    new Decimal(0),
  );
  const notYet = input.closedPartial
    ? new Decimal(0)
    : Decimal.max(new Decimal(poCharges.total).minus(receivedAtPo), 0);

  const invoiceById = new Map(input.invoices.map((inv) => [inv.id, inv]));
  const receiptById = new Map(input.receipts.map((r) => [r.id, r]));
  // Invoice charges shared over its GRs by invoiced goods value.
  const invoiceShare = new Map<string, MoneyCharge[]>();
  const invoicePrice = new Map<string, string>();
  for (const inv of input.invoices) {
    for (const l of inv.lines) invoicePrice.set(l.realizationLineId, l.unitPrice);
    const grs = inv.realizationIds.map((id) => receiptById.get(id)).filter((r): r is ReceiptMoney => Boolean(r));
    const weights = grs.map((r) =>
      r.lines.reduce((s, l) => s.plus(lineAmount(l.qty, invoicePrice.get(l.id) ?? "0")), new Decimal(0)),
    );
    const whole = weights.reduce((s, w) => s.plus(w), new Decimal(0));
    const invCharges = priceStoredCharges(whole.toFixed(0), inv.charges).charges;
    shareCharges(invCharges, weights, whole).forEach((share, i) => invoiceShare.set(grs[i]!.id, share));
  }

  const out = new Map<string, PricedReceipt>();
  let vendorTotal = new Decimal(0);
  input.receipts.forEach((r, i) => {
    if (r.method !== "vendor") return;
    const invoiced = r.invoiceId !== null && invoiceById.has(r.invoiceId);
    const lines = r.lines.map((l) => ({
      id: l.id,
      unitPrice: invoiced ? (invoicePrice.get(l.id) ?? "0") : (poPrice.get(l.poLineId) ?? "0"),
    }));
    const subtotal = r.lines.reduce((s, l, j) => s.plus(lineAmount(l.qty, lines[j]!.unitPrice)), new Decimal(0));
    const charges = invoiced ? (invoiceShare.get(r.id) ?? []) : provisional[i]!;
    const money = priced(subtotal, charges);
    vendorTotal = vendorTotal.plus(money.total);
    out.set(r.id, { invoiced, lines, charges, ...money });
  });
  return {
    receipts: out,
    notYetReceived: notYet.toFixed(0),
    vendorOwed: vendorTotal.plus(notYet).toFixed(0),
  };
}

/**
 * Invoice lines checked against the GR lines it covers: exactly one priced
 * line per GR line, price above 0. Returns the lines and the goods subtotal.
 */
export function checkInvoiceLines(input: {
  receiptLines: Array<{ realizationLineId: string; poLineId: string; qty: string; label: string }>;
  lines: Array<{ realizationLineId: string; unitPrice: string; note: string }>;
}): {
  lines: Array<{ realizationLineId: string; poLineId: string; qty: string; unitPrice: string; note: string }>;
  subtotal: string;
} {
  if (input.receiptLines.length === 0) throw new Error("Pick at least one goods receipt");
  const given = new Map<string, { unitPrice: string; note: string }>();
  for (const l of input.lines) {
    if (given.has(l.realizationLineId)) throw new Error("A receipt line is priced twice");
    given.set(l.realizationLineId, l);
  }
  const known = new Set(input.receiptLines.map((l) => l.realizationLineId));
  if (input.lines.some((l) => !known.has(l.realizationLineId))) {
    throw new Error("A priced line is not on the chosen receipts");
  }
  let subtotal = new Decimal(0);
  const lines = input.receiptLines.map((r) => {
    const g = given.get(r.realizationLineId);
    if (!g) throw new Error(`${r.label}: enter the invoiced price`);
    if (new Decimal(g.unitPrice).lte(0)) throw new Error(`${r.label}: price must be greater than 0`);
    subtotal = subtotal.plus(lineAmount(r.qty, g.unitPrice));
    return { ...r, unitPrice: g.unitPrice, note: g.note.trim() };
  });
  return { lines, subtotal: subtotal.toFixed(0) };
}
