import Decimal from "decimal.js";
import type { Types } from "mongoose";
import type {
  MaterialDispatchOutDto,
  ProductionMaterialAtVendorOutDto,
} from "../../dto/production.dto";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import {
  MATERIAL_DISPATCH_HOLDING,
  MaterialDispatchRepo,
  type MaterialDispatchInterface,
} from "../../models/materialDispatch.model";
import type { ProductionOrderInterface } from "../../models/productionOrder.model";
import { PurchaseOrderRepo } from "../../models/purchaseOrder.model";
import { VendorRepo } from "../../models/vendor.model";
import { userEmailsById } from "../../utils/shared";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { labourItemIds, loadItemMeta } from "../itemMaster/itemMeta";
import type { DispatchableMaterial } from "./production.planner";
import { approvedFeeOrders, postedReceiptsByKey } from "./vendorWork";

/** Subcon material dispatch reads, shared by the SPK detail and the dispatch service. */

type LeanOrder = ProductionOrderInterface & { _id: Types.ObjectId };
export type LeanDispatch = MaterialDispatchInterface & { _id: Types.ObjectId };

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function key(materialItemId: string, itemUomId: string): string {
  return `${materialItemId}:${itemUomId}`;
}

type Flow = {
  materialItemId: string;
  itemUomId: string;
  need: Decimal;
  receivedAtUs: Decimal;
  onTheWay: Decimal;
  sent: Decimal;
  direct: Decimal;
};

/** Each non-fee SPK material and where it is; `exceptDispatchId` leaves one dispatch out. */
export async function materialFlow(order: LeanOrder, exceptDispatchId?: Types.ObjectId): Promise<Flow[]> {
  if (order.type !== "subcon" || !order.snapshot) return [];
  const all = order.snapshot.materials.map((m) => ({
    materialItemId: String(m.materialItemId),
    itemUomId: String(m.itemUomId),
    qty: m.qty,
  }));
  const labour = await labourItemIds(all.map((m) => m.materialItemId));
  const materials = all.filter((m) => !labour.has(m.materialItemId));
  if (materials.length === 0) return [];
  const query: Record<string, unknown> = {
    productionOrderId: order._id,
    status: { $in: MATERIAL_DISPATCH_HOLDING },
  };
  if (exceptDispatchId) query._id = { $ne: exceptDispatchId };
  const [receipts, dispatches] = await Promise.all([
    postedReceiptsByKey(order._id),
    MaterialDispatchRepo.model.find(query).select({ status: 1, lines: 1 }).lean().exec(),
  ]);
  const sent = new Map<string, Decimal>();
  const onTheWay = new Map<string, Decimal>();
  for (const d of dispatches) {
    const target = d.status === "sent" ? sent : onTheWay;
    for (const l of d.lines) {
      const k = key(String(l.materialItemId), String(l.itemUomId));
      target.set(k, (target.get(k) ?? new Decimal(0)).plus(l.qty));
    }
  }
  const zero = new Decimal(0);
  return materials.map((m) => {
    const k = key(m.materialItemId, m.itemUomId);
    return {
      materialItemId: m.materialItemId,
      itemUomId: m.itemUomId,
      need: new Decimal(m.qty),
      receivedAtUs: receipts.atUs.get(k) ?? zero,
      onTheWay: onTheWay.get(k) ?? zero,
      sent: sent.get(k) ?? zero,
      direct: receipts.direct.get(k) ?? zero,
    };
  });
}

function available(f: Flow): Decimal {
  return f.receivedAtUs.minus(f.sent).minus(f.onTheWay);
}

/** What may be put on a dispatch, by material key. */
export async function dispatchable(
  order: LeanOrder,
  exceptDispatchId?: Types.ObjectId,
): Promise<Map<string, DispatchableMaterial>> {
  const flow = await materialFlow(order, exceptDispatchId);
  const { items } = await loadItemMeta(flow.map((f) => f.materialItemId));
  return new Map(
    flow.map((f) => [
      key(f.materialItemId, f.itemUomId),
      { label: items.get(f.materialItemId)?.name ?? "Material", available: available(f) },
    ]),
  );
}

export async function materialsAtVendorOut(order: LeanOrder): Promise<ProductionMaterialAtVendorOutDto[]> {
  const flow = await materialFlow(order);
  if (flow.length === 0) return [];
  const { items, uoms } = await loadItemMeta(flow.map((f) => f.materialItemId));
  return flow
    .map((f) => ({
      materialItemId: f.materialItemId,
      materialName: items.get(f.materialItemId)?.name ?? "Unknown",
      itemUomId: f.itemUomId,
      uomSymbol: uoms.get(f.itemUomId)?.symbol ?? "—",
      needQty: formatDecimal(f.need),
      receivedAtUsQty: formatDecimal(f.receivedAtUs),
      onTheWayQty: formatDecimal(f.onTheWay),
      availableQty: formatDecimal(Decimal.max(available(f), 0)),
      atVendorQty: formatDecimal(f.sent.plus(f.direct)),
    }))
    .sort((a, b) => a.materialName.localeCompare(b.materialName));
}

/** Where a subcon SPK's material goes: the vendor of its first approved fee PO. */
export async function dispatchVendorOf(
  order: LeanOrder,
): Promise<{ vendorId: Types.ObjectId; vendorName: string; purchaseOrderId: Types.ObjectId; purchaseOrderNumber: string } | null> {
  if (order.type !== "subcon") return null;
  const [fee] = await approvedFeeOrders(order._id);
  if (!fee) return null;
  const vendor = await VendorRepo.model.findById(fee.vendorId).select({ name: 1 }).lean().exec();
  return {
    vendorId: fee.vendorId,
    vendorName: vendor?.name ?? "Unknown vendor",
    purchaseOrderId: fee._id,
    purchaseOrderNumber: fee.number,
  };
}

export async function dispatchesOut(orderId: Types.ObjectId): Promise<MaterialDispatchOutDto[]> {
  const docs = (await MaterialDispatchRepo.model
    .find({ productionOrderId: orderId })
    .sort({ createdAt: -1 })
    .lean()
    .exec()) as LeanDispatch[];
  if (docs.length === 0) return [];
  const [meta, vendors, pos, names] = await Promise.all([
    loadItemMeta(docs.flatMap((d) => d.lines.map((l) => String(l.materialItemId)))),
    VendorRepo.model.find({ _id: { $in: docs.map((d) => d.vendorId) } }).select({ name: 1 }).lean().exec(),
    PurchaseOrderRepo.model
      .find({ _id: { $in: docs.map((d) => d.feePurchaseOrderId) } })
      .select({ number: 1 })
      .lean()
      .exec(),
    userEmailsById(
      docs
        .flatMap((d) => [d.createdBy, d.approvedBy, d.rejectedBy, d.sentBy, d.cancelledBy, d.voidedBy])
        .filter(Boolean)
        .map(String),
    ),
  ]);
  const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
  const poNumber = new Map(pos.map((p) => [String(p._id), p.number]));
  const ref = (oid: Types.ObjectId | null | undefined): ProjectRabUserRefOutDto | null =>
    oid ? { id: String(oid), name: names.get(String(oid)) ?? String(oid) } : null;
  return docs.map((d) => ({
    id: String(d._id),
    number: d.number,
    status: d.status,
    vendorName: vendorName.get(String(d.vendorId)) ?? "Unknown vendor",
    feePurchaseOrderNumber: poNumber.get(String(d.feePurchaseOrderId)) ?? "—",
    dispatchDate: d.dispatchDate,
    lines: d.lines.map((l) => {
      const item = meta.items.get(String(l.materialItemId));
      return {
        materialItemId: String(l.materialItemId),
        materialCode: item?.code ?? "—",
        materialName: item?.name ?? "Unknown",
        itemUomId: String(l.itemUomId),
        uomSymbol: meta.uoms.get(String(l.itemUomId))?.symbol ?? "—",
        qty: l.qty,
      };
    }),
    notes: d.notes ?? "",
    receivedByName: d.receivedByName ?? "",
    photos: (d.photos ?? []).map((p) => ({
      id: String(p._id),
      originalFilename: p.originalFilename,
      contentType: p.contentType,
      sizeBytes: p.sizeBytes,
      uploadedAt: p.uploadedAt.toISOString(),
    })),
    createdBy: ref(d.createdBy),
    createdAt: iso(d.createdAt),
    submittedAt: iso(d.submittedAt),
    approvedBy: ref(d.approvedBy),
    approvedAt: iso(d.approvedAt),
    rejectedBy: ref(d.rejectedBy),
    rejectedAt: iso(d.rejectedAt),
    rejectReason: d.rejectReason ?? "",
    sentBy: ref(d.sentBy),
    sentAt: iso(d.sentAt),
    cancelledBy: ref(d.cancelledBy),
    cancelledAt: iso(d.cancelledAt),
    cancelReason: d.cancelReason ?? "",
    voidedBy: ref(d.voidedBy),
    voidedAt: iso(d.voidedAt),
    voidReason: d.voidReason ?? "",
  }));
}

/** The SPK detail's subcon part: material status, dispatches and where material goes. */
export async function subconDispatchOut(order: LeanOrder): Promise<{
  materialsAtVendor: ProductionMaterialAtVendorOutDto[];
  dispatches: MaterialDispatchOutDto[];
  dispatchVendor: { vendorName: string; purchaseOrderNumber: string } | null;
}> {
  if (order.type !== "subcon") return { materialsAtVendor: [], dispatches: [], dispatchVendor: null };
  const [materialsAtVendor, dispatches, vendor] = await Promise.all([
    materialsAtVendorOut(order),
    dispatchesOut(order._id),
    dispatchVendorOf(order),
  ]);
  return {
    materialsAtVendor,
    dispatches,
    dispatchVendor: vendor
      ? { vendorName: vendor.vendorName, purchaseOrderNumber: vendor.purchaseOrderNumber }
      : null,
  };
}
