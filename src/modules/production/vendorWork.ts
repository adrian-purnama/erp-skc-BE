import Decimal from "decimal.js";
import { Types } from "mongoose";
import type {
  ProductionHandoverOutDto,
  ProductionVendorFeeOutDto,
} from "../../dto/production.dto";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import {
  ProductionHandoverRepo,
  type ProductionHandoverInterface,
} from "../../models/productionHandover.model";
import {
  ProductionOrderRepo,
  type ProductionOrderInterface,
} from "../../models/productionOrder.model";
import { ProductionReportRepo } from "../../models/productionReport.model";
import { PurchaseOrderRepo } from "../../models/purchaseOrder.model";
import { PurchaseRealizationRepo } from "../../models/purchaseRealization.model";
import { VendorRepo } from "../../models/vendor.model";
import { userEmailsById } from "../../utils/shared";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { labourItemIds, loadItemMeta } from "../itemMaster/itemMeta";
import { assertFeeWithinHandover, feeReceivableQty } from "./production.planner";

/**
 * Subcon / outsource SPK helpers shared by production and purchasing:
 * handovers as DTOs, and the vendor fee received in step with handovers.
 */

type LeanOrder = ProductionOrderInterface & { _id: Types.ObjectId };
type LeanHandover = ProductionHandoverInterface & { _id: Types.ObjectId };
type FeeLine = { key: string; materialItemId: string; itemUomId: string; qty: string };

/** Subcon and outsource SPKs carry the vendor fee; inhouse does not. */
export function hasVendorFee(type: ProductionOrderInterface["type"]): boolean {
  return type !== "inhouse";
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function feeKey(materialItemId: string, itemUomId: string): string {
  return `${materialItemId}:${itemUomId}`;
}

/** Finished qty on one SPK: its live (not voided) production reports. */
export async function doneOnOrder(orderId: Types.ObjectId): Promise<string> {
  const rows = await ProductionReportRepo.model
    .find({ productionOrderId: orderId, isVoided: false })
    .select({ qtyDone: 1 })
    .lean()
    .exec();
  return formatDecimal(rows.reduce((sum, r) => sum.plus(r.qtyDone), new Decimal(0)));
}

/** A released vendor SPK's fee lines: the snapshot materials that are labour items. */
async function feeLines(order: LeanOrder): Promise<FeeLine[]> {
  if (!hasVendorFee(order.type) || !order.snapshot) return [];
  const materials = order.snapshot.materials.map((m) => ({
    materialItemId: String(m.materialItemId),
    itemUomId: String(m.itemUomId),
    qty: m.qty,
  }));
  const labour = await labourItemIds(materials.map((m) => m.materialItemId));
  return materials
    .filter((m) => labour.has(m.materialItemId))
    .map((m) => ({ ...m, key: feeKey(m.materialItemId, m.itemUomId) }));
}

/** Fee qty per fee key on live (draft / posted) realizations of the SPK's PO lines. */
async function receivedFees(
  orderId: Types.ObjectId,
  exceptRealizationId?: string,
): Promise<Map<string, Decimal>> {
  const pos = await PurchaseOrderRepo.model
    .find({ "lines.productionOrderId": orderId })
    .select({ lines: 1 })
    .lean()
    .exec();
  const keyByPoLine = new Map<string, string>();
  for (const po of pos) {
    for (const l of po.lines) {
      if (l._id && l.productionOrderId && String(l.productionOrderId) === String(orderId)) {
        keyByPoLine.set(String(l._id), feeKey(String(l.materialItemId), String(l.itemUomId)));
      }
    }
  }
  const sums = new Map<string, Decimal>();
  if (keyByPoLine.size === 0) return sums;
  const query: Record<string, unknown> = {
    "lines.poLineId": { $in: [...keyByPoLine.keys()].map((id) => new Types.ObjectId(id)) },
    status: { $in: ["draft", "posted"] },
  };
  if (exceptRealizationId) query._id = { $ne: new Types.ObjectId(exceptRealizationId) };
  const docs = await PurchaseRealizationRepo.model.find(query).select({ lines: 1 }).lean().exec();
  for (const d of docs) {
    for (const l of d.lines) {
      const key = keyByPoLine.get(String(l.poLineId));
      if (key) sums.set(key, (sums.get(key) ?? new Decimal(0)).plus(l.qty));
    }
  }
  return sums;
}

/** Each fee line with what may be received so far (by handover) and what is. */
export async function vendorFeesOut(order: LeanOrder): Promise<ProductionVendorFeeOutDto[]> {
  const fees = await feeLines(order);
  if (fees.length === 0) return [];
  const [received, done, meta] = await Promise.all([
    receivedFees(order._id),
    doneOnOrder(order._id),
    loadItemMeta(fees.map((f) => f.materialItemId)),
  ]);
  return fees.map((f) => ({
    materialItemId: f.materialItemId,
    materialName: meta.items.get(f.materialItemId)?.name ?? "Unknown",
    itemUomId: f.itemUomId,
    uomSymbol: meta.uoms.get(f.itemUomId)?.symbol ?? "—",
    feeQty: f.qty,
    receivableQty: formatDecimal(feeReceivableQty(f.qty, order.qty, done)),
    receivedQty: formatDecimal(received.get(f.key) ?? new Decimal(0)),
  }));
}

/** Voiding a handover would leave fee received past the new handed-over share. */
export async function assertFeeCoveredAfterVoid(order: LeanOrder, doneAfter: string): Promise<void> {
  const fees = await feeLines(order);
  if (fees.length === 0) return;
  const [received, meta] = await Promise.all([
    receivedFees(order._id),
    loadItemMeta(fees.map((f) => f.materialItemId)),
  ]);
  for (const f of fees) {
    try {
      assertFeeWithinHandover({
        label: meta.items.get(f.materialItemId)?.name ?? "Vendor fee",
        feeQty: f.qty,
        spkQty: order.qty,
        doneQty: doneAfter,
        realizedQty: formatDecimal(received.get(f.key) ?? new Decimal(0)),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Void the vendor fee realization first. After this void, ${message}`);
    }
  }
}

/**
 * A realization may receive a vendor fee only in step with the handovers:
 * fee received (all realizations) ≤ fee × handed over / SPK qty.
 */
export async function assertRealizationFeeWithinHandover(input: {
  purchaseOrderId: string;
  lines: Array<{ poLineId: string; qty: string }>;
  exceptRealizationId?: string;
}): Promise<void> {
  const po = await PurchaseOrderRepo.model
    .findById(input.purchaseOrderId)
    .select({ lines: 1 })
    .lean()
    .exec();
  if (!po) return;
  const poLines = new Map(po.lines.map((l) => [String(l._id), l]));
  const qtyByOrder = new Map<string, Map<string, Decimal>>();
  for (const l of input.lines) {
    const poLine = poLines.get(l.poLineId);
    if (!poLine?.productionOrderId) continue;
    const orderId = String(poLine.productionOrderId);
    const byKey = qtyByOrder.get(orderId) ?? new Map<string, Decimal>();
    const key = feeKey(String(poLine.materialItemId), String(poLine.itemUomId));
    byKey.set(key, (byKey.get(key) ?? new Decimal(0)).plus(l.qty));
    qtyByOrder.set(orderId, byKey);
  }
  for (const [orderId, thisQty] of qtyByOrder) {
    const order = (await ProductionOrderRepo.model.findById(orderId).lean().exec()) as LeanOrder | null;
    if (!order) continue;
    const fees = (await feeLines(order)).filter((f) => thisQty.has(f.key));
    if (fees.length === 0) continue;
    const [received, done, meta] = await Promise.all([
      receivedFees(order._id, input.exceptRealizationId),
      doneOnOrder(order._id),
      loadItemMeta(fees.map((f) => f.materialItemId)),
    ]);
    for (const f of fees) {
      assertFeeWithinHandover({
        label: `${meta.items.get(f.materialItemId)?.name ?? "Vendor fee"} (${order.number})`,
        feeQty: f.qty,
        spkQty: order.qty,
        doneQty: done,
        realizedQty: formatDecimal((received.get(f.key) ?? new Decimal(0)).plus(thisQty.get(f.key)!)),
      });
    }
  }
}

/** An SPK's handovers, newest first. */
export async function handoversOut(orderId: Types.ObjectId): Promise<ProductionHandoverOutDto[]> {
  const docs = (await ProductionHandoverRepo.model
    .find({ productionOrderId: orderId })
    .sort({ handoverDate: -1, createdAt: -1 })
    .lean()
    .exec()) as LeanHandover[];
  if (docs.length === 0) return [];
  const names = await userEmailsById(
    docs.flatMap((d) => [d.createdBy, d.postedBy, d.voidedBy]).filter(Boolean).map(String),
  );
  const ref = (oid: Types.ObjectId | null | undefined): ProjectRabUserRefOutDto | null =>
    oid ? { id: String(oid), name: names.get(String(oid)) ?? String(oid) } : null;
  return docs.map((d) => ({
    id: String(d._id),
    number: d.number,
    productionOrderId: String(d.productionOrderId),
    status: d.status,
    handoverDate: d.handoverDate,
    qty: d.qty,
    deliveryNoteNumber: d.deliveryNoteNumber ?? "",
    receivedByUserId: d.receivedByUserId ? String(d.receivedByUserId) : null,
    receivedByName: d.receivedByName ?? "",
    notes: d.notes ?? "",
    checklist: (d.checklist ?? []).map((c) => ({
      label: c.label,
      result: c.result ?? null,
      note: c.note ?? "",
    })),
    photos: (d.photos ?? []).map((p) => ({
      id: String(p._id),
      originalFilename: p.originalFilename,
      contentType: p.contentType,
      sizeBytes: p.sizeBytes,
      uploadedAt: p.uploadedAt.toISOString(),
    })),
    createdBy: ref(d.createdBy),
    createdAt: iso(d.createdAt),
    postedAt: iso(d.postedAt),
    postedBy: ref(d.postedBy),
    voidedAt: iso(d.voidedAt),
    voidedBy: ref(d.voidedBy),
    voidReason: d.voidReason ?? "",
  }));
}

/** A subcon SPK's approved fee POs: the vendor it works with (the first one leads). */
export async function approvedFeeOrders(
  orderId: Types.ObjectId,
): Promise<Array<{ _id: Types.ObjectId; number: string; vendorId: Types.ObjectId }>> {
  const pos = await PurchaseOrderRepo.model
    .find({ "lines.productionOrderId": orderId, status: "approved" })
    .select({ number: 1, vendorId: 1, lines: 1, approvedAt: 1 })
    .sort({ approvedAt: 1 })
    .lean()
    .exec();
  const labour = await labourItemIds(
    pos.flatMap((p) => p.lines.map((l) => String(l.materialItemId))),
  );
  return pos
    .filter((p) =>
      p.lines.some(
        (l) => String(l.productionOrderId) === String(orderId) && labour.has(String(l.materialItemId)),
      ),
    )
    .map((p) => ({ _id: p._id, number: p.number, vendorId: p.vendorId }));
}

/** Per SPK material: posted receipts that arrived at us, and those the supplier sent straight to the vendor. */
export async function postedReceiptsByKey(
  orderId: Types.ObjectId,
): Promise<{ atUs: Map<string, Decimal>; direct: Map<string, Decimal> }> {
  const pos = await PurchaseOrderRepo.model
    .find({ "lines.productionOrderId": orderId })
    .select({ lines: 1 })
    .lean()
    .exec();
  const keyByPoLine = new Map<string, string>();
  for (const po of pos) {
    for (const l of po.lines) {
      if (l._id && String(l.productionOrderId) === String(orderId)) {
        keyByPoLine.set(String(l._id), feeKey(String(l.materialItemId), String(l.itemUomId)));
      }
    }
  }
  const atUs = new Map<string, Decimal>();
  const direct = new Map<string, Decimal>();
  if (keyByPoLine.size === 0) return { atUs, direct };
  const docs = await PurchaseRealizationRepo.model
    .find({
      "lines.poLineId": { $in: [...keyByPoLine.keys()].map((id) => new Types.ObjectId(id)) },
      status: "posted",
    })
    .select({ lines: 1, deliveredTo: 1 })
    .lean()
    .exec();
  for (const d of docs) {
    const target = d.deliveredTo === "vendor" ? direct : atUs;
    for (const l of d.lines) {
      const key = keyByPoLine.get(String(l.poLineId));
      if (key) target.set(key, (target.get(key) ?? new Decimal(0)).plus(l.qty));
    }
  }
  return { atUs, direct };
}

/**
 * A receipt may go straight to the vendor when every line is material (not
 * the fee) of a subcon SPK that already has an approved fee PO. Returns the
 * vendors it would reach, or null when it may not.
 */
export async function directToVendorTargets(purchaseOrderId: string): Promise<string[] | null> {
  const po = await PurchaseOrderRepo.model.findById(purchaseOrderId).select({ lines: 1 }).lean().exec();
  if (!po || po.lines.length === 0) return null;
  const orderIds = [...new Set(po.lines.map((l) => (l.productionOrderId ? String(l.productionOrderId) : "")))];
  if (orderIds.includes("")) return null;
  const labour = await labourItemIds(po.lines.map((l) => String(l.materialItemId)));
  if (po.lines.some((l) => labour.has(String(l.materialItemId)))) return null;
  const vendorIds = new Set<string>();
  for (const id of orderIds) {
    const order = (await ProductionOrderRepo.model.findById(id).select({ type: 1 }).lean().exec()) as
      | Pick<LeanOrder, "_id" | "type">
      | null;
    if (!order || order.type !== "subcon") return null;
    const fee = await approvedFeeOrders(order._id);
    if (fee.length === 0) return null;
    vendorIds.add(String(fee[0]!.vendorId));
  }
  const vendors = await VendorRepo.model
    .find({ _id: { $in: [...vendorIds].map((id) => new Types.ObjectId(id)) } })
    .select({ name: 1 })
    .lean()
    .exec();
  return vendors.map((v) => v.name);
}
