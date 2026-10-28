import Decimal from "decimal.js";
import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import type {
  CreatePurchaseRequestInDto,
  PurchaseRequestLineInDto,
  PurchaseRequestLineOutDto,
  PurchaseRequestOutDto,
  PurchaseRequestPlanOutDto,
  PurchaseRequestStatusDto,
  PurchaseRequestSummaryOutDto,
  PurchasingMaterialOutDto,
  PurchasingProjectContextOutDto,
  PurchasingProjectOutDto,
  UpdatePurchaseRequestInDto,
} from "../../dto/purchasing.dto";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import { ItemUomRepo } from "../../models/itemUom/itemUom.model";
import {
  ProductionOrderRepo,
  type ProductionOrderInterface,
  type ProductionOrderStatus,
} from "../../models/productionOrder/productionOrder.model";
import { ProjectRepo } from "../../models/project/project.model";
import { ProjectRabRepo } from "../../models/projectRab/projectRab.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem/projectShopDrawingItem.model";
import {
  PurchaseRequestRepo,
  type PurchaseRequestInterface,
} from "../../models/purchaseRequest/purchaseRequest.model";
import { PurchaseOrderRepo } from "../../models/purchaseOrder/purchaseOrder.model";
import { PurchasingSeqCounterModel } from "../../models/seqCounter/seqCounter.model";
import { VendorRepo } from "../../models/vendor/vendor.model";
import { userEmailsById } from "../../utils/shared";
import { itemMasterService } from "../itemMaster/itemMaster.service";
import { loadItemMeta } from "../itemMaster/itemMeta";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { itemUomService } from "../itemMaster/itemUom.service";
import { projectNumberParts } from "../project/projectNumber";
import { shopDrawingItemLabel } from "../project/projectShared";
import { liveOrderLines, type LiveOrderLine } from "./purchaseOrderLines";
import { receivedByRequestLine } from "./goodsReceiptLines";
import { addFlow, type MaterialFlowRow } from "./goodsReceipt.planner";
import { realizationStatus } from "./purchaseRealization.planner";
import {
  requestLineOrderStatus,
  requestOrderStatus,
  sumOrdered,
} from "./purchaseOrder.planner";
import {
  checkRequestLines,
  materialKey,
  requestPlan,
  sumRequested,
  type CheckedRequestLine,
  type SpkMaterialRow,
} from "./purchasing.planner";

type LeanRequest = PurchaseRequestInterface & { _id: Types.ObjectId };
type LeanOrder = ProductionOrderInterface & { _id: Types.ObjectId };

/** Who is asking: list scope and who may change a request. */
export type PurchasingViewer = {
  userId: string;
  /** May see every SPP (purchasing.viewAll / manage / *). */
  viewAll: boolean;
  /** May edit or cancel anyone's SPP (purchasing.manage / *). */
  manage: boolean;
};

const SPK_REQUESTABLE: ProductionOrderStatus[] = ["released", "in_progress"];

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function allocateRequestNumber(): Promise<string> {
  const parts = projectNumberParts();
  const scopeKey = `spp:${parts.scopeKey}`;
  const counter = await PurchasingSeqCounterModel.findOneAndUpdate(
    { scopeKey },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey } },
    { upsert: true, new: true },
  ).exec();
  if (!counter || counter.nextSeq < 1) {
    throw new Error("Failed to allocate SPP number");
  }
  return `SPP/${parts.roman}/${parts.year}/${String(counter.nextSeq).padStart(4, "0")}`;
}

async function requireRequest(id: string): Promise<LeanRequest> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid SPP id");
  const doc = (await PurchaseRequestRepo.model.findById(id).lean().exec()) as LeanRequest | null;
  if (!doc) throw new Error("SPP not found");
  return doc;
}

function canChange(doc: LeanRequest, viewer: PurchasingViewer): boolean {
  return viewer.manage || String(doc.createdBy) === viewer.userId;
}

function assertCanChange(doc: LeanRequest, viewer: PurchasingViewer): void {
  if (!canChange(doc, viewer)) {
    throw new Error("Only the requester or purchasing can change this SPP");
  }
}

async function requireReleasedProject(projectId: string) {
  if (!Types.ObjectId.isValid(projectId)) throw new Error("Invalid project id");
  const project = await ProjectRepo.model
    .findById(projectId)
    .select({ name: 1, projectNumber: 1, productionReleasedAt: 1 })
    .lean()
    .exec();
  if (!project) throw new Error("Project not found");
  if (!project.productionReleasedAt) {
    throw new Error("Project is not released to production yet");
  }
  return project;
}

async function requireOrder(id: string): Promise<LeanOrder> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid SPK id");
  const order = (await ProductionOrderRepo.model.findById(id).lean().exec()) as LeanOrder | null;
  if (!order) throw new Error("SPK not found");
  return order;
}

function spkMaterials(order: LeanOrder): SpkMaterialRow[] {
  return (order.snapshot?.materials ?? []).map((m) => ({
    materialItemId: String(m.materialItemId),
    itemUomId: String(m.itemUomId),
    qty: m.qty,
  }));
}

/** SPK-line qty already asked for on other live (draft / submitted) SPPs. */
async function requestedForOrder(orderId: Types.ObjectId, exceptRequestId?: string) {
  const query: Record<string, unknown> = {
    productionOrderId: orderId,
    status: { $nin: ["cancelled", "declined"] },
  };
  if (exceptRequestId) query._id = { $ne: new Types.ObjectId(exceptRequestId) };
  const docs = (await PurchaseRequestRepo.model
    .find(query)
    .select({ lines: 1 })
    .lean()
    .exec()) as Array<Pick<LeanRequest, "lines">>;
  return sumRequested(
    docs.flatMap((d) =>
      d.lines.map((l) => ({
        source: l.source,
        materialItemId: String(l.materialItemId),
        itemUomId: String(l.itemUomId),
        qty: l.qty,
      })),
    ),
  );
}

async function rabKeysFor(projectId: string): Promise<Set<string>> {
  const rab = await ProjectRabRepo.model
    .findOne({ projectId: new Types.ObjectId(projectId) })
    .select({ lines: 1 })
    .lean()
    .exec();
  return new Set((rab?.lines ?? []).map((l) => l.key));
}

/** Every line's UOM must belong to its material. */
async function assertUomsMatch(lines: PurchaseRequestLineInDto[]): Promise<void> {
  const uoms = await ItemUomRepo.model
    .find({ _id: { $in: lines.map((l) => new Types.ObjectId(l.itemUomId)) } })
    .select({ itemId: 1 })
    .lean()
    .exec();
  const itemByUom = new Map(uoms.map((u) => [String(u._id), String(u.itemId)]));
  for (const line of lines) {
    if (itemByUom.get(line.itemUomId) !== line.materialItemId) {
      throw new Error("A line has a unit that does not belong to its material");
    }
  }
}

/** Validate lines against the SPK plan and the RAB; returns flagged lines. */
async function checkLines(input: {
  projectId: string;
  order: LeanOrder | null;
  lines: PurchaseRequestLineInDto[];
  exceptRequestId?: string;
}): Promise<CheckedRequestLine[]> {
  await assertUomsMatch(input.lines);
  const [requested, rabKeys, meta] = await Promise.all([
    input.order
      ? requestedForOrder(input.order._id, input.exceptRequestId)
      : Promise.resolve(new Map()),
    rabKeysFor(input.projectId),
    loadItemMeta(input.lines.map((l) => l.materialItemId)),
  ]);
  const nameByKey = new Map(
    input.lines.map((l) => [materialKey(l), meta.items.get(l.materialItemId)?.name ?? "Material"]),
  );
  return checkRequestLines({
    lines: input.lines,
    spkMaterials: input.order ? spkMaterials(input.order) : null,
    requested,
    rabKeys,
    label: (key) => nameByKey.get(key) ?? "Material",
  });
}

function linesToDoc(lines: CheckedRequestLine[]): PurchaseRequestInterface["lines"] {
  return lines.map((l) => ({
    source: l.source,
    materialItemId: new Types.ObjectId(l.materialItemId),
    itemUomId: new Types.ObjectId(l.itemUomId),
    qty: l.qty,
    inRab: l.inRab,
    overPlan: l.overPlan,
    note: l.note,
  }));
}

function isFlagged(l: { source: string; inRab: boolean; overPlan: boolean }): boolean {
  return l.source === "extra" || !l.inRab || l.overPlan;
}

export class PurchasingService {
  /** Active Item Master materials with their UOMs (extra-item picker). */
  async listMaterials(): Promise<PurchasingMaterialOutDto[]> {
    const items = await itemMasterService.listActiveItems("material");
    const uomsByItem = await itemUomService.listByItems(items.map((i) => i.id));
    return items.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      name: item.name,
      description: item.description,
      categoryIds: item.categoryIds ?? [],
      baseUomId: item.baseUomId,
      uoms: uomsByItem.get(item.id) ?? [],
    }));
  }

  /** Projects released to production, newest first. */
  async listProjects(): Promise<PurchasingProjectOutDto[]> {
    const projects = await ProjectRepo.model
      .find({ productionReleasedAt: { $ne: null } })
      .select({ name: 1, projectNumber: 1 })
      .sort({ productionReleasedAt: -1 })
      .lean()
      .exec();
    return projects.map((p) => ({
      id: String(p._id),
      projectNumber: p.projectNumber,
      name: p.name,
    }));
  }

  async projectContext(projectId: string): Promise<PurchasingProjectContextOutDto> {
    const project = await requireReleasedProject(projectId);
    const [rabKeys, orders] = await Promise.all([
      rabKeysFor(projectId),
      ProductionOrderRepo.model
        .find({ projectId: new Types.ObjectId(projectId), status: { $in: SPK_REQUESTABLE } })
        .select({ number: 1, shopDrawingItemId: 1 })
        .sort({ number: 1 })
        .lean()
        .exec(),
    ]);
    const items = await ProjectShopDrawingItemRepo.model
      .find({ _id: { $in: orders.map((o) => o.shopDrawingItemId) } })
      .select({ code: 1, name: 1 })
      .lean()
      .exec();
    const itemById = new Map(items.map((i) => [String(i._id), i]));
    return {
      id: projectId,
      projectNumber: project.projectNumber,
      name: project.name,
      rabKeys: [...rabKeys],
      orders: orders.map((o) => {
        const item = itemById.get(String(o.shopDrawingItemId));
        return {
          id: String(o._id),
          number: o.number,
          itemLabel: item ? shopDrawingItemLabel(item) : "Deleted item",
        };
      }),
    };
  }

  /** SPK materials with what other SPPs already asked for. */
  async plan(productionOrderId: string, exceptRequestId?: string): Promise<PurchaseRequestPlanOutDto> {
    const order = await requireOrder(productionOrderId);
    const [project, item, requested, rabKeys] = await Promise.all([
      ProjectRepo.model
        .findById(order.projectId)
        .select({ name: 1, projectNumber: 1 })
        .lean()
        .exec(),
      ProjectShopDrawingItemRepo.model
        .findById(order.shopDrawingItemId)
        .select({ code: 1, name: 1 })
        .lean()
        .exec(),
      requestedForOrder(order._id, exceptRequestId),
      rabKeysFor(String(order.projectId)),
    ]);
    const rows = requestPlan(spkMaterials(order), requested);
    const { items, uoms } = await loadItemMeta(rows.map((r) => r.materialItemId));
    // Ordered / received for this SPK, from its live SPPs.
    const sppDocs = (await PurchaseRequestRepo.model
      .find({ productionOrderId: order._id, status: { $nin: ["cancelled", "declined"] } })
      .select({ lines: 1 })
      .lean()
      .exec()) as Array<Pick<LeanRequest, "_id" | "lines">>;
    const sppIds = sppDocs.map((d) => String(d._id));
    const [poLines, received] = await Promise.all([
      liveOrderLines(sppIds),
      receivedByRequestLine(sppIds),
    ]);
    const orderedByLine = sumOrdered(poLines);
    const flow = new Map<string, MaterialFlowRow>();
    for (const d of sppDocs) {
      for (const l of d.lines) {
        addFlow(flow, materialKey({ materialItemId: String(l.materialItemId), itemUomId: String(l.itemUomId) }), {
          ordered: orderedByLine.get(String(l._id)),
          received: received.get(String(l._id)),
        });
      }
    }
    return {
      productionOrderId: String(order._id),
      productionOrderNumber: order.number,
      projectId: String(order.projectId),
      projectNumber: project?.projectNumber ?? "—",
      projectName: project?.name ?? "Unknown project",
      itemLabel: item ? shopDrawingItemLabel(item) : "Deleted item",
      plannedStart: order.plannedStart ?? null,
      rows: rows
        .map((r) => ({
          materialItemId: r.materialItemId,
          materialCode: items.get(r.materialItemId)?.code ?? "—",
          materialName: items.get(r.materialItemId)?.name ?? "Unknown",
          itemUomId: r.itemUomId,
          uomSymbol: uoms.get(r.itemUomId)?.symbol ?? "—",
          plannedQty: r.plannedQty,
          requestedQty: r.requestedQty,
          remainingQty: r.remainingQty,
          inRab: rabKeys.has(materialKey(r)),
          orderedQty: formatDecimal(flow.get(materialKey(r))?.ordered ?? new Decimal(0)),
          receivedQty: formatDecimal(flow.get(materialKey(r))?.received ?? new Decimal(0)),
        }))
        .sort((a, b) => a.materialName.localeCompare(b.materialName)),
    };
  }

  /**
   * Without projectId / productionOrderId the list is limited to your own
   * SPPs unless you may see all.
   */
  async list(
    filter: {
      projectId?: string;
      productionOrderId?: string;
      status?: PurchaseRequestStatusDto;
      q?: string;
    },
    viewer: PurchasingViewer,
  ): Promise<PurchaseRequestSummaryOutDto[]> {
    const query: Record<string, unknown> = {};
    if (filter.projectId) query.projectId = new Types.ObjectId(filter.projectId);
    if (filter.productionOrderId) {
      query.productionOrderId = new Types.ObjectId(filter.productionOrderId);
    }
    if (filter.status) query.status = filter.status;
    if (!filter.projectId && !filter.productionOrderId && !viewer.viewAll) {
      query.createdBy = new Types.ObjectId(viewer.userId);
    }
    const docs = (await PurchaseRequestRepo.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec()) as LeanRequest[];
    const rows = await this.summaries(docs);
    const q = filter.q?.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.projectNumber, r.projectName, r.productionOrderNumber ?? "", r.itemLabel ?? ""]
        .some((v) => v.toLowerCase().includes(q)),
    );
  }

  async get(id: string, viewer: PurchasingViewer): Promise<PurchaseRequestOutDto> {
    const doc = await requireRequest(id);
    const [summary] = await this.summaries([doc]);
    const { items, uoms } = await loadItemMeta(doc.lines.map((l) => String(l.materialItemId)));
    const poLines = await liveOrderLines([doc._id]);
    const ordered = sumOrdered(poLines);
    const receivedLine = await receivedByRequestLine([String(doc._id)]);
    const [names, pos] = await Promise.all([
      userEmailsById([doc.submittedBy, doc.cancelledBy, doc.declinedBy].filter(Boolean).map(String)),
      PurchaseOrderRepo.model
        .find({ requestId: doc._id })
        .select({ number: 1, status: 1, vendorId: 1, total: 1 })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
    ]);
    const vendors = await VendorRepo.model
      .find({ _id: { $in: pos.map((p) => p.vendorId) } })
      .select({ name: 1 })
      .lean()
      .exec();
    const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
    const ref = (oid: Types.ObjectId | null | undefined): ProjectRabUserRefOutDto | null =>
      oid ? { id: String(oid), name: names.get(String(oid)) ?? String(oid) } : null;
    return {
      ...summary!,
      notes: doc.notes ?? "",
      lines: doc.lines.map((l): PurchaseRequestLineOutDto => {
        const itemId = String(l.materialItemId);
        const uomId = String(l.itemUomId);
        return {
          id: String(l._id),
          source: l.source,
          materialItemId: itemId,
          materialCode: items.get(itemId)?.code ?? "—",
          materialName: items.get(itemId)?.name ?? "Unknown",
          itemUomId: uomId,
          uomSymbol: uoms.get(uomId)?.symbol ?? "—",
          qty: l.qty,
          inRab: l.inRab,
          overPlan: l.overPlan,
          note: l.note ?? "",
          orderedQty: formatDecimal(ordered.get(String(l._id)) ?? new Decimal(0)),
          receivedQty: formatDecimal(receivedLine.get(String(l._id)) ?? new Decimal(0)),
          orderStatus: requestLineOrderStatus(l.qty, ordered.get(String(l._id))),
          orders: poLines
            .filter((p) => p.requestLineId === String(l._id))
            .map((p) => ({ id: p.orderId, number: p.orderNumber, status: p.orderStatus, qty: p.qty })),
        };
      }),
      submittedBy: ref(doc.submittedBy),
      cancelledAt: iso(doc.cancelledAt),
      cancelledBy: ref(doc.cancelledBy),
      cancelReason: doc.cancelReason ?? "",
      declinedAt: iso(doc.declinedAt),
      declinedBy: ref(doc.declinedBy),
      declineReason: doc.declineReason ?? "",
      orders: pos.map((p) => ({
        id: String(p._id),
        number: p.number,
        status: p.status,
        vendorName: vendorName.get(String(p.vendorId)) ?? "Unknown vendor",
        total: p.total,
      })),
      canChange: canChange(doc, viewer),
    };
  }

  async create(
    input: CreatePurchaseRequestInDto,
    viewer: PurchasingViewer,
  ): Promise<PurchaseRequestOutDto> {
    await requireReleasedProject(input.projectId);
    let order: LeanOrder | null = null;
    if (input.productionOrderId) {
      order = await requireOrder(input.productionOrderId);
      if (String(order.projectId) !== input.projectId) {
        throw new Error("SPK belongs to another project");
      }
      if (!SPK_REQUESTABLE.includes(order.status)) {
        throw new Error("Materials can only be requested for a released or in-progress SPK");
      }
    }
    const created = await withTx(async () => {
      const lines = await checkLines({ projectId: input.projectId, order, lines: input.lines });
      return PurchaseRequestRepo.create({
        number: await allocateRequestNumber(),
        projectId: new Types.ObjectId(input.projectId),
        productionOrderId: order ? order._id : null,
        status: "draft",
        neededDate: input.neededDate,
        notes: input.notes,
        lines: linesToDoc(lines),
        createdBy: new Types.ObjectId(viewer.userId),
      });
    });
    return this.get(String(created._id), viewer);
  }

  async update(
    id: string,
    input: UpdatePurchaseRequestInDto,
    viewer: PurchasingViewer,
  ): Promise<PurchaseRequestOutDto> {
    const doc = await requireRequest(id);
    assertCanChange(doc, viewer);
    if (doc.status !== "draft") throw new Error("Only a draft SPP can be edited");
    const order = doc.productionOrderId ? await requireOrder(String(doc.productionOrderId)) : null;
    await withTx(async () => {
      const lines = await checkLines({
        projectId: String(doc.projectId),
        order,
        lines: input.lines,
        exceptRequestId: id,
      });
      const updated = await PurchaseRequestRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        { $set: { neededDate: input.neededDate, notes: input.notes, lines: linesToDoc(lines) } },
      );
      if (!updated) throw new Error("SPP is no longer a draft");
    });
    return this.get(id, viewer);
  }

  async remove(id: string, viewer: PurchasingViewer): Promise<void> {
    const doc = await requireRequest(id);
    assertCanChange(doc, viewer);
    if (doc.status !== "draft") {
      throw new Error("Only a draft SPP can be deleted; cancel a submitted one");
    }
    const removed = await PurchaseRequestRepo.deleteOne({ _id: doc._id, status: "draft" });
    if (!removed) throw new Error("SPP not found");
  }

  /** Hand the request to purchasing; lines are checked again against the current plan. */
  async submit(id: string, viewer: PurchasingViewer): Promise<PurchaseRequestOutDto> {
    const doc = await requireRequest(id);
    assertCanChange(doc, viewer);
    if (doc.status !== "draft") throw new Error("Only a draft SPP can be submitted");
    const order = doc.productionOrderId ? await requireOrder(String(doc.productionOrderId)) : null;
    if (order && !SPK_REQUESTABLE.includes(order.status)) {
      throw new Error("The SPK is no longer released or in progress");
    }
    await withTx(async () => {
      const lines = await checkLines({
        projectId: String(doc.projectId),
        order,
        lines: doc.lines.map((l) => ({
          materialItemId: String(l.materialItemId),
          itemUomId: String(l.itemUomId),
          qty: l.qty,
          note: l.note ?? "",
        })),
        exceptRequestId: id,
      });
      const updated = await PurchaseRequestRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        {
          $set: {
            status: "submitted",
            lines: linesToDoc(lines),
            submittedAt: new Date(),
            submittedBy: new Types.ObjectId(viewer.userId),
          },
        },
      );
      if (!updated) throw new Error("SPP is no longer a draft");
    });
    return this.get(id, viewer);
  }

  async cancel(id: string, reason: string, viewer: PurchasingViewer): Promise<PurchaseRequestOutDto> {
    const doc = await requireRequest(id);
    assertCanChange(doc, viewer);
    if (doc.status !== "submitted") {
      throw new Error("Only a submitted SPP can be cancelled; delete a draft instead");
    }
    const onOrders = await liveOrderLines([doc._id]);
    if (onOrders.length > 0) {
      const numbers = [...new Set(onOrders.map((o) => o.orderNumber))].join(", ");
      throw new Error(`Items are on ${numbers}: cancel or change the PO first`);
    }
    const updated = await PurchaseRequestRepo.findOneAndUpdate(
      { _id: doc._id, status: "submitted" },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledBy: new Types.ObjectId(viewer.userId),
          cancelReason: reason,
        },
      },
    );
    if (!updated) throw new Error("Failed to cancel SPP");
    return this.get(id, viewer);
  }

  /** Purchasing turns the request down; only while nothing is on a live PO. */
  async decline(id: string, reason: string, viewer: PurchasingViewer): Promise<PurchaseRequestOutDto> {
    const doc = await requireRequest(id);
    if (doc.status !== "submitted") throw new Error("Only a submitted SPP can be declined");
    const onOrders = await liveOrderLines([doc._id]);
    if (onOrders.length > 0) {
      const numbers = [...new Set(onOrders.map((o) => o.orderNumber))].join(", ");
      throw new Error(`Items are on ${numbers}: cancel the PO first`);
    }
    const updated = await PurchaseRequestRepo.findOneAndUpdate(
      { _id: doc._id, status: "submitted" },
      {
        $set: {
          status: "declined",
          declinedAt: new Date(),
          declinedBy: new Types.ObjectId(viewer.userId),
          declineReason: reason,
        },
      },
    );
    if (!updated) throw new Error("Failed to decline SPP");
    return this.get(id, viewer);
  }

  private async summaries(docs: LeanRequest[]): Promise<PurchaseRequestSummaryOutDto[]> {
    if (docs.length === 0) return [];
    const projectIds = [...new Set(docs.map((d) => String(d.projectId)))];
    const orderIds = [
      ...new Set(docs.flatMap((d) => (d.productionOrderId ? [String(d.productionOrderId)] : []))),
    ];
    const [projects, orders, names, poLines] = await Promise.all([
      ProjectRepo.model
        .find({ _id: { $in: projectIds.map((id) => new Types.ObjectId(id)) } })
        .select({ name: 1, projectNumber: 1 })
        .lean()
        .exec(),
      ProductionOrderRepo.model
        .find({ _id: { $in: orderIds.map((id) => new Types.ObjectId(id)) } })
        .select({ number: 1, shopDrawingItemId: 1 })
        .lean()
        .exec(),
      userEmailsById(docs.flatMap((d) => (d.createdBy ? [String(d.createdBy)] : []))),
      liveOrderLines(docs.filter((d) => d.status === "submitted").map((d) => d._id)),
    ]);
    const receivedLine = await receivedByRequestLine(
      docs.filter((d) => d.status === "submitted").map((d) => String(d._id)),
    );
    const ordered = sumOrdered(poLines as LiveOrderLine[]);
    const items = await ProjectShopDrawingItemRepo.model
      .find({ _id: { $in: orders.map((o) => o.shopDrawingItemId) } })
      .select({ code: 1, name: 1 })
      .lean()
      .exec();
    const projectById = new Map(projects.map((p) => [String(p._id), p]));
    const orderById = new Map(orders.map((o) => [String(o._id), o]));
    const itemById = new Map(items.map((i) => [String(i._id), i]));
    return docs.map((d) => {
      const project = projectById.get(String(d.projectId));
      const order = d.productionOrderId ? orderById.get(String(d.productionOrderId)) : undefined;
      const item = order ? itemById.get(String(order.shopDrawingItemId)) : undefined;
      const createdBy = d.createdBy ? String(d.createdBy) : null;
      return {
        id: String(d._id),
        number: d.number,
        status: d.status,
        projectId: String(d.projectId),
        projectNumber: project?.projectNumber ?? "—",
        projectName: project?.name ?? "Unknown project",
        productionOrderId: d.productionOrderId ? String(d.productionOrderId) : null,
        productionOrderNumber: order?.number ?? null,
        itemLabel: item ? shopDrawingItemLabel(item) : null,
        neededDate: d.neededDate,
        lineCount: d.lines.length,
        flaggedCount: d.lines.filter(isFlagged).length,
        orderStatus: requestOrderStatus(
          d.lines.map((l) => requestLineOrderStatus(l.qty, ordered.get(String(l._id)))),
        ),
        receiptStatus: realizationStatus(
          d.lines.map((l) => ({ qty: l.qty, realized: receivedLine.get(String(l._id)) })),
        ),
        requestedBy: createdBy
          ? { id: createdBy, name: names.get(createdBy) ?? createdBy }
          : null,
        createdAt: iso(d.createdAt),
        submittedAt: iso(d.submittedAt),
      };
    });
  }
}

export const purchasingService = new PurchasingService();
