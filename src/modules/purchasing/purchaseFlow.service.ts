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
  } else if (kind === "payment") {
    const p = (await PurchasePaymentRepo.model.findById(oid(id)).lean().exec()) as LeanPayment | null;
    if (!p) throw new Error("Payment not found");
    orderIds = p.purchaseOrderId ? [p.purchaseOrderId] : [...new Set(p.items.map((i) => String(i.purchaseOrderId)))].map(oid);
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

  const [requests, realizations, vendorPayments, vendors] = await Promise.all([
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
      .find({ kind: "vendor", purchaseOrderId: { $in: orders.map((o) => o._id) } })
      .sort({ createdAt: 1 })
      .lean()
      .exec() as Promise<LeanPayment[]>,
    VendorRepo.model
      .find({ _id: { $in: orders.map((o) => o.vendorId) } })
      .select({ name: 1 })
      .lean()
      .exec(),
  ]);
  const staffNotaIds = realizations.filter((r) => r.method === "staff" && r.status === "posted").map((r) => r._id);
  const reimbursements = (await PurchasePaymentRepo.model
    .find({ kind: "reimburse", "items.realizationId": { $in: staffNotaIds } })
    .sort({ createdAt: 1 })
    .lean()
    .exec()) as LeanPayment[];

  // The SPK or Purchasing RAB the chain serves.
  const spkIds = new Set<string>(productionOrderId ? [String(productionOrderId)] : []);
  for (const r of requests) if (r.productionOrderId) spkIds.add(String(r.productionOrderId));
  for (const o of orders) for (const l of o.lines) if (l.productionOrderId) spkIds.add(String(l.productionOrderId));
  const rabIds = new Set<string>(requests.filter((r) => r.purchaseRabId).map((r) => String(r.purchaseRabId)));
  const [spks, rabs] = await Promise.all([
    ProductionOrderRepo.model
      .find({ _id: { $in: [...spkIds].map(oid) } })
      .select({ number: 1, type: 1, status: 1 })
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
  let payable = new Decimal(0);
  let vendorPaid = new Decimal(0);
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
      payment = { payable: summary.payable, paid: summary.paidTotal };
      payable = payable.plus(summary.payable);
      vendorPaid = vendorPaid.plus(summary.paidTotal);
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

  const staffTotal = posted.filter((r) => r.method === "staff").reduce((s, r) => s.plus(r.total), new Decimal(0));
  const notaSet = new Set(staffNotaIds.map(String));
  let reimbursed = new Decimal(0);
  for (const p of reimbursements) {
    if (p.status !== "paid") continue;
    for (const i of p.items) {
      if (i.status === "approved" && notaSet.has(String(i.realizationId))) reimbursed = reimbursed.plus(i.amount);
    }
  }

  return {
    focus: { kind, id },
    spks: spks.map((s) => ({ id: String(s._id), number: s.number, type: s.type, status: s.status })),
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
    })),
    payments: [...vendorPayments, ...reimbursements].map((p) => ({
      id: String(p._id),
      number: p.number,
      kind: p.kind,
      status: p.status,
      stage: p.stage ?? null,
      amount: p.amount,
      purchaseOrderId: p.purchaseOrderId ? String(p.purchaseOrderId) : null,
      payeeName: p.payeeName ?? "",
    })),
    totals: {
      ordered: rupiah(orderedTotal),
      receivedGoods: rupiah(receivedTotal),
      /** Vendor payable plus what staff paid themselves. */
      owed: rupiah(payable.plus(staffTotal)),
      paid: rupiah(vendorPaid.plus(reimbursed)),
      staffBought: rupiah(staffTotal),
      reimbursed: rupiah(reimbursed),
    },
  };
}
