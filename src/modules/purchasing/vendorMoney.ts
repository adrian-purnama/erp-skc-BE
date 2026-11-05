import Decimal from "decimal.js";
import { Types } from "mongoose";
import { PurchaseOrderRepo, type PurchaseOrderInterface } from "../../models/purchaseOrder.model";
import { PurchasePaymentRepo } from "../../models/purchasePayment.model";
import {
  PurchaseRealizationRepo,
  type PurchaseRealizationInterface,
} from "../../models/purchaseRealization.model";
import { VendorInvoiceRepo, type VendorInvoiceInterface } from "../../models/vendorInvoice.model";
import { estimatesOf } from "./purchaseOrder.service";
import { inferChargeCategory } from "./purchaseRealization.planner";
import { priceVendorReceipts, type InvoiceMoney, type PricedReceipt } from "./vendorInvoice.planner";

type LeanOrder = PurchaseOrderInterface & { _id: Types.ObjectId };
type LeanRealization = PurchaseRealizationInterface & { _id: Types.ObjectId };
type LeanInvoice = VendorInvoiceInterface & { _id: Types.ObjectId };

/** A change not saved yet, priced as if it were. */
export type MoneyWhatIf = {
  /** Replace (or with `null`, drop) this posted invoice. */
  invoice?: { id: string; next: InvoiceMoney | null };
  /** As if this realization were voided. */
  exceptRealizationId?: string;
};

export function invoiceMoneyOf(doc: Pick<LeanInvoice, "realizationIds" | "lines" | "charges"> & { _id: Types.ObjectId | string }): InvoiceMoney {
  return {
    id: String(doc._id),
    realizationIds: doc.realizationIds.map(String),
    lines: doc.lines.map((l) => ({ realizationLineId: String(l.realizationLineId), unitPrice: l.unitPrice })),
    charges: doc.charges.map((c) => ({ ...c, category: c.category ?? inferChargeCategory(c.label) })),
  };
}

/**
 * A PO's vendor money: each posted vendor GR priced (invoice, else PO), the
 * part not yet received, and what the vendor is owed. Posted realizations of
 * both methods, oldest posting first.
 */
export async function vendorMoney(order: LeanOrder, whatIf: MoneyWhatIf = {}) {
  const [realizations, invoices] = await Promise.all([
    PurchaseRealizationRepo.model
      .find({
        purchaseOrderId: order._id,
        status: "posted",
        ...(whatIf.exceptRealizationId ? { _id: { $ne: new Types.ObjectId(whatIf.exceptRealizationId) } } : {}),
      })
      .sort({ postedAt: 1, createdAt: 1 })
      .lean()
      .exec() as Promise<LeanRealization[]>,
    VendorInvoiceRepo.model.find({ purchaseOrderId: order._id, status: "posted" }).lean().exec() as Promise<LeanInvoice[]>,
  ]);
  let money = invoices.map(invoiceMoneyOf);
  if (whatIf.invoice) {
    money = money.filter((m) => m.id !== whatIf.invoice!.id);
    if (whatIf.invoice.next) money.push(whatIf.invoice.next);
  }
  const invoiceOf = new Map<string, string>();
  for (const m of money) for (const rid of m.realizationIds) invoiceOf.set(rid, m.id);
  const result = priceVendorReceipts({
    poLines: order.lines.map((l) => ({ id: String(l._id), qty: l.qty, unitPrice: l.unitPrice })),
    poCharges: estimatesOf(order).charges,
    closedPartial: order.closedPartial === true,
    receipts: realizations.map((r) => ({
      id: String(r._id),
      method: r.method,
      lines: r.lines.map((l) => ({ id: String(l._id), poLineId: String(l.poLineId), qty: l.qty })),
      invoiceId: invoiceOf.get(String(r._id)) ?? null,
    })),
    invoices: money,
  });
  const vendorReceipts = realizations.filter((r) => r.method === "vendor");
  return {
    ...result,
    realizations,
    vendorReceipts,
    /** Owed is actual: everything received and every GR invoiced. */
    final:
      result.notYetReceived === "0" && vendorReceipts.every((r) => result.receipts.get(String(r._id))?.invoiced),
  };
}

/** Σ vendor payments approved or paid on the PO: money the vendor already has or will get. */
async function committedToVendor(orderId: Types.ObjectId): Promise<Decimal> {
  const docs = await PurchasePaymentRepo.model
    .find({ purchaseOrderId: orderId, kind: "vendor", status: { $in: ["approved", "paid"] } })
    .select({ amount: 1 })
    .lean()
    .exec();
  return docs.reduce((s, d) => s.plus(d.amount), new Decimal(0));
}

/** Refuse a change that would leave the vendor owed less than approved / paid payments. */
export async function assertVendorNotOverpaid(order: LeanOrder, whatIf: MoneyWhatIf): Promise<void> {
  const { vendorOwed } = await vendorMoney(order, whatIf);
  const committed = await committedToVendor(order._id);
  if (committed.gt(vendorOwed)) {
    throw new Error(
      `The vendor would be owed Rp ${vendorOwed}, but Rp ${committed.toFixed(0)} is already approved or paid to them. Cancel a payment first`,
    );
  }
}

function sameMoney(r: LeanRealization, p: PricedReceipt): boolean {
  const prices = new Map(p.lines.map((l) => [l.id, l.unitPrice]));
  return (
    r.total === p.total &&
    r.subtotal === p.subtotal &&
    r.chargesTotal === p.chargesTotal &&
    r.charges.length === p.charges.length &&
    r.charges.every((c, i) => c.amount === p.charges[i]!.amount && c.label === p.charges[i]!.label) &&
    r.lines.every((l) => prices.get(String(l._id)) === l.unitPrice)
  );
}

/**
 * Write the calculated money onto every posted vendor GR of the PO, so every
 * report reading GR totals stays in step. Run after a GR is posted or voided
 * and after an invoice is posted, changed or voided.
 */
export async function repriceVendorReceipts(orderId: Types.ObjectId | string): Promise<void> {
  const order = (await PurchaseOrderRepo.model.findById(orderId).lean().exec()) as LeanOrder | null;
  if (!order) return;
  const money = await vendorMoney(order);
  for (const r of money.vendorReceipts) {
    const p = money.receipts.get(String(r._id));
    if (!p || sameMoney(r, p)) continue;
    const price = new Map(p.lines.map((l) => [l.id, l.unitPrice]));
    await PurchaseRealizationRepo.findOneAndUpdate(
      { _id: r._id, status: "posted" },
      {
        $set: {
          lines: r.lines.map((l) => ({ ...l, unitPrice: price.get(String(l._id)) ?? l.unitPrice })),
          charges: p.charges,
          subtotal: p.subtotal,
          chargesTotal: p.chargesTotal,
          total: p.total,
        },
      },
    );
  }
}
