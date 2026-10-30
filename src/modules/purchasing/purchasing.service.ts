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
  PurchasingSpkOutDto,
  UpdatePurchaseRequestInDto,
} from "../../dto/purchasing.dto";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import { ItemUomRepo } from "../../models/itemUom.model";
import {
  ProductionOrderRepo,
  type ProductionOrderInterface,
  type ProductionOrderStatus,
} from "../../models/productionOrder.model";
import { ProjectRepo } from "../../models/project.model";
import { ProjectRabRepo } from "../../models/projectRab.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem.model";
import { PurchaseRabRepo, type PurchaseRabInterface } from "../../models/purchaseRab.model";
import {
  PurchaseRequestRepo,
  type PurchaseRequestInterface,
} from "../../models/purchaseRequest.model";
import { PurchaseOrderRepo } from "../../models/purchaseOrder.model";
import { PurchasingSeqCounterModel } from "../../models/seqCounter.model";
import { VendorRepo } from "../../models/vendor.model";
import { userEmailsById } from "../../utils/shared";
import { itemMasterService } from "../itemMaster/itemMaster.service";
import { loadItemMeta } from "../itemMaster/itemMeta";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { itemUomService } from "../itemMaster/itemUom.service";
import { projectNumberParts } from "../project/projectNumber";
import { rabRowsForPurchasing } from "../project/projectRab.planner";
import { shopDrawingItemLabel } from "../project/projectShared";
import { liveOrderLines, type LiveOrderLine } from "./purchaseOrderLines";
import { arrivedByRequestLine } from "./realizationLines";
import { realizationStatus } from "./purchaseRealization.planner";
import {
  requestLineOrderStatus,
  requestOrderStatus,
  sumOrdered,
} from "./purchaseOrder.planner";
import {
  addFlow,
  checkRequestLines,
  materialKey,
  requestPlan,
  sumRequested,
  type CheckedRequestLine,
  type MaterialFlowRow,
  type SpkMaterialRow,
} from "./purchasing.planner";

type LeanRequest = PurchaseRequestInterface & { _id: Types.ObjectId };
type LeanOrder = ProductionOrderInterface & { _id: Types.ObjectId };
type LeanRab = PurchaseRabInterface & { _id: Types.ObjectId };

/** What an SPP is made for: one SPK, one Purchasing RAB, or (older SPPs) neither. */
type RequestBasisDoc = { order: LeanOrder | null; rab: LeanRab | null };

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

async function requireRab(id: string): Promise<LeanRab> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid RAB id");
  const rab = (await PurchaseRabRepo.model.findById(id).lean().exec()) as LeanRab | null;
  if (!rab) throw new Error("RAB not found");
  return rab;
}

async function basisOf(doc: LeanRequest): Promise<RequestBasisDoc> {
  return {
    order: doc.productionOrderId ? await requireOrder(String(doc.productionOrderId)) : null,
    rab: doc.purchaseRabId ? await requireRab(String(doc.purchaseRabId)) : null,
  };
}

function rabMaterials(rab: LeanRab): SpkMaterialRow[] {
  return rab.lines.map((l) => ({
    materialItemId: String(l.materialItemId),
    itemUomId: String(l.itemUomId),
    qty: l.qty,
  }));
}

function spkMaterials(order: LeanOrder): SpkMaterialRow[] {
  return (order.snapshot?.materials ?? []).map((m) => ({
    materialItemId: String(m.materialItemId),
    itemUomId: String(m.itemUomId),
    qty: m.qty,
  }));
}

/** SPK / RAB-line qty already asked for on other live (draft / submitted) SPPs. */
async function requestedFor(
  basis: { productionOrderId: Types.ObjectId } | { purchaseRabId: Types.ObjectId },
  exceptRequestId?: string,
) {
  const query: Record<string, unknown> = {
    ...basis,
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
  // By material×UOM: labour (e.g. an outsource fee) is keyed per drawing in the RAB.
  return new Set(rabRowsForPurchasing(rab?.lines ?? []).map((r) => r.key));
}

/** Every line's UOM must belong to its material. */
export async function assertUomsMatch(
  lines: Array<Pick<PurchaseRequestLineInDto, "materialItemId" | "itemUomId">>,
): Promise<void> {
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

/** Keys "on the RAB": the Purchasing RAB's own lines, else the project RAB. */
async function basisRabKeys(projectId: string | null, rab: LeanRab | null): Promise<Set<string>> {
  if (rab) return new Set(rab.lines.map((l) => l.key));
  return projectId ? rabKeysFor(projectId) : new Set();
}

/** Validate lines against the SPK plan / Purchasing RAB and the RAB; returns flagged lines. */
async function checkLines(input: RequestBasisDoc & {
  projectId: string | null;
  lines: PurchaseRequestLineInDto[];
  exceptRequestId?: string;
}): Promise<CheckedRequestLine[]> {
  await assertUomsMatch(input.lines);
  const [requested, rabKeys, meta] = await Promise.all([
    input.order
      ? requestedFor({ productionOrderId: input.order._id }, input.exceptRequestId)
      : input.rab
        ? requestedFor({ purchaseRabId: input.rab._id }, input.exceptRequestId)
        : Promise.resolve(new Map<string, Decimal>()),
    basisRabKeys(input.projectId, input.rab),
    loadItemMeta(input.lines.map((l) => l.materialItemId)),
  ]);
  const nameByKey = new Map(
    input.lines.map((l) => [materialKey(l), meta.items.get(l.materialItemId)?.name ?? "Material"]),
  );
  return checkRequestLines({
    lines: input.lines,
    basis: input.rab ? "rab" : "spk",
    planMaterials: input.order
      ? spkMaterials(input.order)
      : input.rab
        ? rabMaterials(input.rab)
        : null,
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
  /**
   * Active Item Master items with their UOMs (SPP item picker). Labour items
   * are included: an outsource SPK requests its vendor fee as a labour item.
   */
  async listMaterials(): Promise<PurchasingMaterialOutDto[]> {
    const items = await itemMasterService.listActiveItems();
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

  /** SPKs the user is PIC of that can still take a request (project released). */
  async listMySpks(userId: string): Promise<PurchasingSpkOutDto[]> {
    const orders = await ProductionOrderRepo.model
      .find({ picUserId: new Types.ObjectId(userId), status: { $in: SPK_REQUESTABLE } })
      .select({ number: 1, projectId: 1, shopDrawingItemId: 1 })
      .sort({ number: 1 })
      .lean()
      .exec();
    if (orders.length === 0) return [];
    const [projects, items] = await Promise.all([
      ProjectRepo.model
        .find({
          _id: { $in: orders.map((o) => o.projectId) },
          productionReleasedAt: { $ne: null },
        })
        .select({ name: 1, projectNumber: 1 })
        .lean()
        .exec(),
      ProjectShopDrawingItemRepo.model
        .find({ _id: { $in: orders.map((o) => o.shopDrawingItemId) } })
        .select({ code: 1, name: 1 })
        .lean()
        .exec(),
    ]);
    const projectById = new Map(projects.map((p) => [String(p._id), p]));
    const itemById = new Map(items.map((i) => [String(i._id), i]));
    return orders.flatMap((o) => {
      const project = projectById.get(String(o.projectId));
      if (!project) return [];
      const item = itemById.get(String(o.shopDrawingItemId));
      return [
        {
          id: String(o._id),
          number: o.number,
          itemLabel: item ? shopDrawingItemLabel(item) : "Deleted item",
          projectId: String(o.projectId),
          projectNumber: project.projectNumber,
          projectName: project.name,
        },
      ];
    });
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
      requestedFor({ productionOrderId: order._id }, exceptRequestId),
      rabKeysFor(String(order.projectId)),
    ]);
    const rows = await this.planRows(
      { productionOrderId: order._id },
      requestPlan(spkMaterials(order), requested),
      rabKeys,
      new Map(),
    );
    return {
      basis: "spk",
      productionOrderId: String(order._id),
      productionOrderNumber: order.number,
      purchaseRabId: null,
      purchaseRabNumber: null,
      projectId: String(order.projectId),
      projectNumber: project?.projectNumber ?? "—",
      projectName: project?.name ?? "Unknown project",
      itemLabel: item ? shopDrawingItemLabel(item) : "Deleted item",
      plannedStart: order.plannedStart ?? null,
      rabKeys: [...rabKeys],
      rows,
    };
  }

  /** Purchasing RAB lines with what other SPPs already asked for. */
  async rabPlan(purchaseRabId: string, exceptRequestId?: string): Promise<PurchaseRequestPlanOutDto> {
    const rab = await requireRab(purchaseRabId);
    const requested = await requestedFor({ purchaseRabId: rab._id }, exceptRequestId);
    const rabKeys = new Set(rab.lines.map((l) => l.key));
    const rows = await this.planRows(
      { purchaseRabId: rab._id },
      requestPlan(rabMaterials(rab), requested),
      rabKeys,
      new Map(rab.lines.map((l) => [l.key, l.unitPrice])),
    );
    return {
      basis: "rab",
      productionOrderId: null,
      productionOrderNumber: null,
      purchaseRabId: String(rab._id),
      purchaseRabNumber: rab.number,
      projectId: null,
      projectNumber: null,
      projectName: null,
      itemLabel: rab.title,
      plannedStart: null,
      rabKeys: [...rabKeys],
      rows,
    };
  }

  /** Plan rows with labels and what is ordered / arrived on the basis's live SPPs. */
  private async planRows(
    basis: { productionOrderId: Types.ObjectId } | { purchaseRabId: Types.ObjectId },
    rows: ReturnType<typeof requestPlan>,
    rabKeys: Set<string>,
    unitPrices: Map<string, string>,
  ): Promise<PurchaseRequestPlanOutDto["rows"]> {
    const { items, uoms } = await loadItemMeta(rows.map((r) => r.materialItemId));
    const sppDocs = (await PurchaseRequestRepo.model
      .find({ ...basis, status: { $nin: ["cancelled", "declined"] } })
      .select({ lines: 1 })
      .lean()
      .exec()) as Array<Pick<LeanRequest, "_id" | "lines">>;
    const sppIds = sppDocs.map((d) => String(d._id));
    const [poLines, received] = await Promise.all([
      liveOrderLines(sppIds),
      arrivedByRequestLine(sppIds),
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
    return rows
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
          unitPrice: unitPrices.get(materialKey(r)) ?? null,
          orderedQty: formatDecimal(flow.get(materialKey(r))?.ordered ?? new Decimal(0)),
          receivedQty: formatDecimal(flow.get(materialKey(r))?.received ?? new Decimal(0)),
        }))
        .sort((a, b) => a.materialName.localeCompare(b.materialName));
  }

  /**
   * Without projectId / productionOrderId the list is limited to your own
   * SPPs unless you may see all.
   */
  async list(
    filter: {
      projectId?: string;
      productionOrderId?: string;
      purchaseRabId?: string;
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
    if (filter.purchaseRabId) query.purchaseRabId = new Types.ObjectId(filter.purchaseRabId);
    if (filter.status) query.status = filter.status;
    if (!filter.projectId && !filter.productionOrderId && !filter.purchaseRabId && !viewer.viewAll) {
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
      [
        r.number,
        r.projectNumber,
        r.projectName,
        r.productionOrderNumber ?? "",
        r.itemLabel ?? "",
        r.purchaseRabNumber ?? "",
        r.purchaseRabTitle ?? "",
      ]
        .some((v) => v.toLowerCase().includes(q)),
    );
  }

  async get(id: string, viewer: PurchasingViewer): Promise<PurchaseRequestOutDto> {
    const doc = await requireRequest(id);
    const [summary] = await this.summaries([doc]);
    const { items, uoms } = await loadItemMeta(doc.lines.map((l) => String(l.materialItemId)));
    const poLines = await liveOrderLines([doc._id]);
    const ordered = sumOrdered(poLines);
    const receivedLine = await arrivedByRequestLine([String(doc._id)]);
    const [names, pos] = await Promise.all([
      userEmailsById(
        [doc.submittedBy, doc.cancelledBy, doc.declinedBy, doc.receivedBy].filter(Boolean).map(String),
      ),
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
      receivedBy: ref(doc.receivedBy),
      canConfirmReceived:
        String(doc.createdBy) === viewer.userId &&
        doc.status === "submitted" &&
        !doc.receivedAt &&
        summary!.receiptStatus === "full",
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
    let order: LeanOrder | null = null;
    let rab: LeanRab | null = null;
    let projectId: string | null = null;
    if (input.productionOrderId) {
      order = await requireOrder(input.productionOrderId);
      projectId = String(order.projectId);
      await requireReleasedProject(projectId);
      if (!SPK_REQUESTABLE.includes(order.status)) {
        throw new Error("Materials can only be requested for a released or in-progress SPK");
      }
    } else if (input.purchaseRabId) {
      rab = await requireRab(input.purchaseRabId);
      if (rab.status !== "locked") throw new Error("Only a locked RAB can be requested from");
    } else {
      throw new Error("Choose either an SPK or a RAB");
    }
    const created = await withTx(async () => {
      const lines = await checkLines({ projectId, order, rab, lines: input.lines });
      return PurchaseRequestRepo.create({
        number: await allocateRequestNumber(),
        projectId: projectId ? new Types.ObjectId(projectId) : null,
        productionOrderId: order ? order._id : null,
        purchaseRabId: rab ? rab._id : null,
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
    const basis = await basisOf(doc);
    await withTx(async () => {
      const lines = await checkLines({
        ...basis,
        projectId: doc.projectId ? String(doc.projectId) : null,
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
    const basis = await basisOf(doc);
    if (basis.order && !SPK_REQUESTABLE.includes(basis.order.status)) {
      throw new Error("The SPK is no longer released or in progress");
    }
    if (basis.rab && basis.rab.status !== "locked") {
      throw new Error("The RAB is no longer locked");
    }
    await withTx(async () => {
      const lines = await checkLines({
        ...basis,
        projectId: doc.projectId ? String(doc.projectId) : null,
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

  /** The requester confirms they got everything, once it has all arrived. */
  async confirmReceived(id: string, viewer: PurchasingViewer): Promise<PurchaseRequestOutDto> {
    const doc = await requireRequest(id);
    if (String(doc.createdBy) !== viewer.userId) {
      throw new Error("Only the person who made this SPP can confirm it was received");
    }
    if (doc.status !== "submitted") throw new Error("Only a submitted SPP can be confirmed as received");
    if (doc.receivedAt) throw new Error("This SPP was already confirmed as received");
    const arrived = await arrivedByRequestLine([String(doc._id)]);
    const status = realizationStatus(
      doc.lines.map((l) => ({ qty: l.qty, realized: arrived.get(String(l._id)) })),
    );
    if (status !== "full") throw new Error("Not everything has arrived yet");
    const updated = await PurchaseRequestRepo.findOneAndUpdate(
      { _id: doc._id, status: "submitted", receivedAt: null },
      { $set: { receivedAt: new Date(), receivedBy: new Types.ObjectId(viewer.userId) } },
    );
    if (!updated) throw new Error("Failed to confirm SPP");
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
    const projectIds = [...new Set(docs.flatMap((d) => (d.projectId ? [String(d.projectId)] : [])))];
    const orderIds = [
      ...new Set(docs.flatMap((d) => (d.productionOrderId ? [String(d.productionOrderId)] : []))),
    ];
    const rabIds = [...new Set(docs.flatMap((d) => (d.purchaseRabId ? [String(d.purchaseRabId)] : [])))];
    const [projects, orders, rabs, names, poLines] = await Promise.all([
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
      PurchaseRabRepo.model
        .find({ _id: { $in: rabIds.map((id) => new Types.ObjectId(id)) } })
        .select({ number: 1, title: 1 })
        .lean()
        .exec(),
      userEmailsById(docs.flatMap((d) => (d.createdBy ? [String(d.createdBy)] : []))),
      liveOrderLines(docs.filter((d) => d.status === "submitted").map((d) => d._id)),
    ]);
    const receivedLine = await arrivedByRequestLine(
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
    const rabById = new Map(rabs.map((r) => [String(r._id), r]));
    const itemById = new Map(items.map((i) => [String(i._id), i]));
    return docs.map((d) => {
      const project = d.projectId ? projectById.get(String(d.projectId)) : undefined;
      const rab = d.purchaseRabId ? rabById.get(String(d.purchaseRabId)) : undefined;
      const order = d.productionOrderId ? orderById.get(String(d.productionOrderId)) : undefined;
      const item = order ? itemById.get(String(order.shopDrawingItemId)) : undefined;
      const createdBy = d.createdBy ? String(d.createdBy) : null;
      return {
        id: String(d._id),
        number: d.number,
        status: d.status,
        projectId: d.projectId ? String(d.projectId) : null,
        projectNumber: d.projectId ? (project?.projectNumber ?? "—") : "—",
        projectName: d.projectId ? (project?.name ?? "Unknown project") : "No project",
        productionOrderId: d.productionOrderId ? String(d.productionOrderId) : null,
        productionOrderNumber: order?.number ?? null,
        purchaseRabId: d.purchaseRabId ? String(d.purchaseRabId) : null,
        purchaseRabNumber: rab?.number ?? null,
        purchaseRabTitle: rab?.title ?? null,
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
        receivedAt: iso(d.receivedAt),
        createdAt: iso(d.createdAt),
        submittedAt: iso(d.submittedAt),
      };
    });
  }
}

export const purchasingService = new PurchasingService();
