import Decimal from "decimal.js";
import { Types } from "mongoose";
import type { PurchaseFlowKindDto, PurchaseFlowOutDto } from "../../dto/purchasing.dto";
import { ProductionOrderRepo } from "../../models/productionOrder.model";
import {
  PURCHASE_ORDER_LIVE_STATUSES,
  PurchaseOrderRepo,
  type PurchaseOrderInterface,
} from "../../models/purchaseOrder.model";
import { PurchasePaymentRepo, type PurchasePaymentInterface } from "../../models/purchasePayment.model";
import { PurchaseRabRepo } from "../../models/purchaseRab.model";
import {
  PurchaseRealizationRepo,
  type PurchaseRealizationInterface,
} from "../../models/purchaseRealization.model";
import { PurchaseRequestRepo } from "../../models/purchaseRequest.model";
import { VendorRepo } from "../../models/vendor.model";
import { VendorInvoiceRepo } from "../../models/vendorInvoice.model";
import { labourItemIds } from "../itemMaster/itemMeta";
import { estimatesOf } from "./purchaseOrder.service";
import { purchasePaymentService } from "./purchasePayment.service";
import { realizationStatus, sumRealized } from "./purchaseRealization.planner";

type LeanOrder = PurchaseOrderInterface & { _id: Types.ObjectId };
type LeanRealization = PurchaseRealizationInterface & { _id: Types.ObjectId };
type LeanPayment = PurchasePaymentInterface & { _id: Types.ObjectId };

function oid(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid id");
  return new Types.ObjectId(id);
}

function rupiah(d: Decimal): string {
  return d.toFixed(0);
}

/**
 * A requester's view of their own SPP: the request and its POs (number,
 * vendor, status), without receipts, invoices, payments or amounts.
 */
export function requesterFlow(flow: PurchaseFlowOutDto): PurchaseFlowOutDto {
  return {
    ...flow,
    stages: ["request", "order"],
    purchaseRabs: [],
    orders: flow.orders.map((o) => ({
      ...o,
      total: "0",
      estimatedTotal: "0",
      receivedSubtotal: "0",
      payable: null,
      paid: null,
    })),
    realizations: [],
    invoices: [],
    payments: [],
    totals: {
      ordered: "0",
      receivedGoods: "0",
      owed: "0",
      paid: "0",
      staffBought: "0",
      reimbursed: "0",
    },
  };
}

/**
 * The purchasing chain around one document, related documents only:
 * SPP → PO → receipts → payments / reimbursements, plus the SPK or
 * Purchasing RAB it serves. A PO, receipt or vendor payment narrows the
 * chain to its own PO; an SPP or SPK covers all of its POs.
 */
export async function purchaseFlow(kind: PurchaseFlowKindDto, id: string): Promise<PurchaseFlowOutDto> {
  let orderIds: Types.ObjectId[] = [];
  let requestIds: Types.ObjectId[] = [];
  let productionOrderId: Types.ObjectId | null = null;

  if (kind === "request") {
    requestIds = [oid(id)];
    const pos = await PurchaseOrderRepo.model
      .find({ $or: [{ requestId: oid(id) }, { "lines.requestId": oid(id) }] })
      .select({ _id: 1 })
      .lean()
      .exec();
    orderIds = pos.map((p) => p._id);
  } else if (kind === "order") {
    orderIds = [oid(id)];
  } else if (kind === "realization") {
    const r = await PurchaseRealizationRepo.model.findById(oid(id)).select({ purchaseOrderId: 1 }).lean().exec();
    if (!r) throw new Error("Realization not found");
    orderIds = [r.purchaseOrderId];
  } else if (kind === "invoice") {
    const inv = await VendorInvoiceRepo.model.findById(oid(id)).select({ purchaseOrderId: 1 }).lean().exec();
    if (!inv) throw new Error("Vendor invoice not found");
    orderIds = [inv.purchaseOrderId];
  } else if (kind === "payment") {
    const p = (await PurchasePaymentRepo.model.findById(oid(id)).lean().exec()) as LeanPayment | null;
    if (!p) throw new Error("Payment not found");
    orderIds = [p.purchaseOrderId];
  } else {
    productionOrderId = oid(id);
    const [pos, spps] = await Promise.all([
      PurchaseOrderRepo.model.find({ "lines.productionOrderId": productionOrderId }).select({ _id: 1 }).lean().exec(),
      PurchaseRequestRepo.model.find({ productionOrderId }).select({ _id: 1 }).lean().exec(),
    ]);
    orderIds = pos.map((p) => p._id);
    requestIds = spps.map((s) => s._id);
  }

  const orders = (await PurchaseOrderRepo.model
    .find({ _id: { $in: orderIds } })
    .sort({ createdAt: 1 })
    .lean()
    .exec()) as LeanOrder[];
  if (kind !== "request" && kind !== "spk") {
    requestIds = [
      ...new Set(orders.flatMap((o) => [String(o.requestId), ...o.lines.map((l) => String(l.requestId))])),
    ].map(oid);
  }

  const [requests, realizations, payments, vendors, invoices] = await Promise.all([
    PurchaseRequestRepo.model
      .find({ _id: { $in: requestIds } })
      .select({ number: 1, status: 1, productionOrderId: 1, purchaseRabId: 1 })
      .sort({ createdAt: 1 })
      .lean()
      .exec(),
    PurchaseRealizationRepo.model
      .find({ purchaseOrderId: { $in: orders.map((o) => o._id) }, status: { $ne: "voided" } })
      .sort({ purchaseDate: 1, createdAt: 1 })
      .lean()
      .exec() as Promise<LeanRealization[]>,
    PurchasePaymentRepo.model
      .find({ purchaseOrderId: { $in: orders.map((o) => o._id) } })
      .sort({ createdAt: 1 })
      .lean()
      .exec() as Promise<LeanPayment[]>,
    VendorRepo.model
      .find({ _id: { $in: orders.map((o) => o.vendorId) } })
      .select({ name: 1 })
      .lean()
      .exec(),
    VendorInvoiceRepo.model
      .find({ purchaseOrderId: { $in: orders.map((o) => o._id) }, status: { $in: ["draft", "posted"] } })
      .sort({ createdAt: 1 })
      .lean()
      .exec(),
  ]);

  // The SPK or Purchasing RAB the chain serves.
  const spkIds = new Set<string>(productionOrderId ? [String(productionOrderId)] : []);
  for (const r of requests) if (r.productionOrderId) spkIds.add(String(r.productionOrderId));
  for (const o of orders) for (const l of o.lines) if (l.productionOrderId) spkIds.add(String(l.productionOrderId));
  const rabIds = new Set<string>(requests.filter((r) => r.purchaseRabId).map((r) => String(r.purchaseRabId)));
  const [spks, rabs] = await Promise.all([
    ProductionOrderRepo.model
      .find({ _id: { $in: [...spkIds].map(oid) } })
      .select({ number: 1, labourName: 1, executor: 1, status: 1 })
      .lean()
      .exec(),
    PurchaseRabRepo.model
      .find({ _id: { $in: [...rabIds].map(oid) } })
      .select({ number: 1 })
      .lean()
      .exec(),
  ]);

  const labour = await labourItemIds(orders.flatMap((o) => o.lines.map((l) => String(l.materialItemId))));
  const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
  const posted = realizations.filter((r) => r.status === "posted");

  let orderedTotal = new Decimal(0);
  let receivedTotal = new Decimal(0);
  let owed = new Decimal(0);
  let paid = new Decimal(0);
  let staffTotal = new Decimal(0);
  let reimbursed = new Decimal(0);
  const orderOut: PurchaseFlowOutDto["orders"] = [];
  for (const o of orders) {
    const mine = posted.filter((r) => String(r.purchaseOrderId) === String(o._id));
    const realized = sumRealized(mine.flatMap((r) => r.lines.map((l) => ({ poLineId: String(l.poLineId), qty: l.qty }))));
    const live = PURCHASE_ORDER_LIVE_STATUSES.includes(o.status) || o.closedPartial === true;
    const received = mine.reduce((sum, r) => sum.plus(r.subtotal || 0), new Decimal(0));
    if (live) {
      orderedTotal = orderedTotal.plus(o.total);
      receivedTotal = receivedTotal.plus(received);
    }
    let payment: { payable: string; paid: string } | null = null;
    if (o.status === "approved" || o.closedPartial) {
      const summary = await purchasePaymentService.forOrder(String(o._id));
      const vendor = summary.payees[0]!;
      payment = { payable: vendor.owed, paid: vendor.paidTotal };
      owed = owed.plus(summary.owedTotal);
      paid = paid.plus(summary.paidTotal);
      for (const p of summary.payees.slice(1)) {
        staffTotal = staffTotal.plus(p.owed);
        reimbursed = reimbursed.plus(p.paidTotal);
      }
    }
    orderOut.push({
      id: String(o._id),
      number: o.number,
      status: o.status,
      closedPartial: o.closedPartial === true,
      approvalLevel: o.approvalLevel ?? null,
      vendorName: vendorName.get(String(o.vendorId)) ?? "Unknown vendor",
      total: o.total,
      estimatedTotal: estimatesOf(o).total,
      vendorFee: o.lines.some((l) => labour.has(String(l.materialItemId))),
      receipt: realizationStatus(o.lines.map((l) => ({ qty: l.qty, realized: realized.get(String(l._id)) }))),
      receivedSubtotal: rupiah(received),
      payable: payment?.payable ?? null,
      paid: payment?.paid ?? null,
    });
  }


  return {
    focus: { kind, id },
    stages: ["request", "order", "receive", "invoice", "pay"],
    spks: spks.map((s) => ({
      id: String(s._id),
      number: s.number,
      labourName: s.labourName,
      executor: s.executor,
      status: s.status,
    })),
    purchaseRabs: rabs.map((r) => ({ id: String(r._id), number: r.number })),
    requests: requests.map((r) => ({ id: String(r._id), number: r.number, status: r.status })),
    orders: orderOut,
    realizations: realizations.map((r) => ({
      id: String(r._id),
      number: r.number,
      status: r.status,
      method: r.method,
      purchaseOrderId: String(r.purchaseOrderId),
      total: r.total,
      deliveredTo: r.deliveredTo ?? "us",
      invoiceId: r.invoiceId ? String(r.invoiceId) : null,
    })),
    invoices: invoices.map((inv) => ({
      id: String(inv._id),
      number: inv.number,
      status: inv.status,
      purchaseOrderId: String(inv.purchaseOrderId),
      vendorInvoiceNumber: inv.vendorInvoiceNumber ?? "",
      total: inv.total,
    })),
    payments: payments.map((p) => ({
      id: String(p._id),
      number: p.number,
      kind: p.kind,
      status: p.status,
      stage: p.stage,
      amount: p.amount,
      purchaseOrderId: String(p.purchaseOrderId),
      payeeName: p.payeeName ?? "",
    })),
    totals: {
      ordered: rupiah(orderedTotal),
      receivedGoods: rupiah(receivedTotal),
      /** Vendor payable plus what staff paid themselves. */
      owed: rupiah(owed),
      paid: rupiah(paid),
      staffBought: rupiah(staffTotal),
      reimbursed: rupiah(reimbursed),
    },
  };
}
