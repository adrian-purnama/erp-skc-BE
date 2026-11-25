import Decimal from "decimal.js";
import { Types } from "mongoose";
import {
  PURCHASE_ORDER_LIVE_STATUSES,
  PurchaseOrderRepo,
  type PurchaseOrderStatus,
} from "../../models/purchaseOrder.model";
import {
  PurchaseRealizationRepo,
  type PurchaseRealizationStatus,
} from "../../models/purchaseRealization.model";
import {
  PurchaseRequestRepo,
  type PurchaseRequestStatus,
} from "../../models/purchaseRequest.model";

/** An SPP is live while it is a draft or awaits a PO. */
export const LIVE_REQUEST_STATUSES: PurchaseRequestStatus[] = ["draft", "submitted"];

/** A realization (receipt) counts unless it was voided. */
export const LIVE_REALIZATION_STATUSES: PurchaseRealizationStatus[] = ["draft", "posted"];

/** A PO line on an SPK, as other modules see it. */
export type SpkPurchaseOrderLineDto = {
  id: string;
  materialItemId: string;
  itemUomId: string;
  qty: string;
  unitPrice: string;
};

/** A PO that carries lines for an SPK; `lines` holds that SPK's lines only. */
export type SpkPurchaseOrderDto = {
  id: string;
  number: string;
  vendorId: string;
  status: PurchaseOrderStatus;
  createdBy: string | null;
  lines: SpkPurchaseOrderLineDto[];
};

/** A PO line with the SPK it serves, if any. */
export type PurchaseOrderLineRefDto = {
  id: string;
  productionOrderId: string | null;
  materialItemId: string;
  itemUomId: string;
  qty: string;
};

/** Realized qty of one PO line: arrived at us, or sent straight to the vendor. */
export type RealizedQtyDto = { toUs: string; toVendor: string };

const toObjectIds = (ids: readonly (string | null | undefined)[]) =>
  [...new Set(ids.filter((id): id is string => !!id))]
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

/** Live SPPs plus live POs that still point at any of these SPKs. */
export async function countLivePurchasesForSpks(spkIds: readonly string[]): Promise<number> {
  const ids = toObjectIds(spkIds);
  if (ids.length === 0) return 0;
  const [requests, orders] = await Promise.all([
    PurchaseRequestRepo.model
      .countDocuments({ productionOrderId: { $in: ids }, status: { $in: LIVE_REQUEST_STATUSES } })
      .exec(),
    PurchaseOrderRepo.model
      .countDocuments({
        "lines.productionOrderId": { $in: ids },
        status: { $in: PURCHASE_ORDER_LIVE_STATUSES },
      })
      .exec(),
  ]);
  return requests + orders;
}

/**
 * POs with lines on the SPK. `approvedOnly` keeps approved POs; `sort` is
 * "newest" (created, newest first) or "firstApproved" (approval, oldest first).
 * Without `sort` the order is the store's.
 */
export async function listSpkPurchaseOrders(
  spkId: string,
  opts: { approvedOnly?: boolean; sort?: "newest" | "firstApproved" } = {},
): Promise<SpkPurchaseOrderDto[]> {
  const spk = new Types.ObjectId(spkId);
  let q = PurchaseOrderRepo.model
    .find({ "lines.productionOrderId": spk, ...(opts.approvedOnly ? { status: "approved" } : {}) })
    .select({ number: 1, vendorId: 1, status: 1, createdBy: 1, lines: 1 });
  if (opts.sort === "newest") q = q.sort({ createdAt: -1 });
  if (opts.sort === "firstApproved") q = q.sort({ approvedAt: 1 });
  const docs = await q.lean().exec();
  return docs.map((po) => ({
    id: String(po._id),
    number: po.number,
    vendorId: String(po.vendorId),
    status: po.status,
    createdBy: po.createdBy ? String(po.createdBy) : null,
    lines: po.lines
      .filter((l) => l._id && l.productionOrderId && String(l.productionOrderId) === spkId)
      .map((l) => ({
        id: String(l._id),
        materialItemId: String(l.materialItemId),
        itemUomId: String(l.itemUomId),
        qty: l.qty,
        unitPrice: l.unitPrice,
      })),
  }));
}

/**
 * Realized qty per asked PO line: live realizations (draft / posted), or
 * posted ones only. `exceptRealizationId` leaves one realization out.
 */
export async function realizedQtyByPoLine(
  poLineIds: readonly string[],
  opts: { postedOnly?: boolean; exceptRealizationId?: string } = {},
): Promise<Map<string, RealizedQtyDto>> {
  const out = new Map<string, RealizedQtyDto>();
  const ids = toObjectIds(poLineIds);
  if (ids.length === 0) return out;
  const filter: Record<string, unknown> = {
    "lines.poLineId": { $in: ids },
    status: { $in: opts.postedOnly ? ["posted"] : LIVE_REALIZATION_STATUSES },
  };
  if (opts.exceptRealizationId) filter._id = { $ne: new Types.ObjectId(opts.exceptRealizationId) };
  const docs = await PurchaseRealizationRepo.model
    .find(filter)
    .select({ lines: 1, deliveredTo: 1 })
    .lean()
    .exec();
  const asked = new Set(ids.map(String));
  const sums = new Map<string, { toUs: Decimal; toVendor: Decimal }>();
  for (const d of docs) {
    const side = d.deliveredTo === "vendor" ? "toVendor" : "toUs";
    for (const l of d.lines) {
      const key = String(l.poLineId);
      if (!asked.has(key)) continue;
      const sum = sums.get(key) ?? { toUs: new Decimal(0), toVendor: new Decimal(0) };
      sum[side] = sum[side].plus(l.qty);
      sums.set(key, sum);
    }
  }
  for (const [key, s] of sums) out.set(key, { toUs: s.toUs.toString(), toVendor: s.toVendor.toString() });
  return out;
}

/** PO id → PO number. */
export async function getPurchaseOrderNumbers(
  poIds: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const ids = toObjectIds(poIds);
  if (ids.length === 0) return new Map();
  const docs = await PurchaseOrderRepo.model
    .find({ _id: { $in: ids } })
    .select({ number: 1 })
    .lean()
    .exec();
  return new Map(docs.map((p) => [String(p._id), p.number]));
}

/** A PO's lines with the SPK each serves; null when there is no such PO. */
export async function getPurchaseOrderLines(poId: string): Promise<PurchaseOrderLineRefDto[] | null> {
  const po = await PurchaseOrderRepo.model.findById(poId).select({ lines: 1 }).lean().exec();
  if (!po) return null;
  return po.lines.map((l) => ({
    id: String(l._id),
    productionOrderId: l.productionOrderId ? String(l.productionOrderId) : null,
    materialItemId: String(l.materialItemId),
    itemUomId: String(l.itemUomId),
    qty: l.qty,
  }));
}
