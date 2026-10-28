import Decimal from "decimal.js";
import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import type {
  CreateProductionOrderInDto,
  CreateProductionReportInDto,
  ProductionItemProgressOutDto,
  ProductionOrderFileRefOutDto,
  ProductionOrderMaterialOutDto,
  ProductionOrderOutDto,
  ProductionOrderStatusDto,
  ProductionOrderSummaryOutDto,
  ProductionPicUserOutDto,
  ProductionProjectProgressOutDto,
  ProductionReadinessOutDto,
  ProductionReportOutDto,
  UpdateProductionOrderInDto,
} from "../../dto/production.dto";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import { ProjectRepo } from "../../models/project/project.model";
import {
  ProductionOrderRepo,
  type ProductionOrderInterface,
  type ProductionOrderStatus,
} from "../../models/productionOrder/productionOrder.model";
import {
  ProductionReportRepo,
  type ProductionReportInterface,
} from "../../models/productionReport/productionReport.model";
import { ProjectProductionFileRepo } from "../../models/projectProductionFile/projectProductionFile.model";
import { ProjectQuotationRepo } from "../../models/projectQuotation/projectQuotation.model";
import { ProjectRabRepo } from "../../models/projectRab/projectRab.model";
import {
  ProjectShopDrawingBoqRepo,
  type ProjectShopDrawingBoqInterface,
} from "../../models/projectShopDrawingBoq/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument/projectShopDrawingDocument.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem/projectShopDrawingItem.model";
import { ProductionSeqCounterModel } from "../../models/seqCounter/seqCounter.model";
import { UserModel } from "../../models/user/user.model";
import { CustomerRepo } from "../../models/customer/customer.model";
import { findFile, readFileBuffer } from "../../buckets/gridfs";
import { logger } from "../../logger/logger";
import { appConfigService } from "../appConfig/AppConfig.service";
import { env } from "../../environment/env";
import {
  formatExportYmd,
  safeFilenamePart,
} from "../project/projectRabExport.planner";
import { formatLongDate, splitLines } from "../quotation/quotation.document";
import type { QuotationLogo } from "../quotation/quotation.logo";
import { buildSpkPdf, type SpkPdfData } from "./production.pdf";
import { jakartaYmdString, userEmailsById } from "../../utils/shared";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { loadItemMeta } from "../itemMaster/itemMeta";
import { projectNumberParts } from "../project/projectNumber";
import { projectRabChangeService } from "../project/projectRabChange.service";
import { shopDrawingItemLabel } from "../project/projectShared";
import {
  assertOrderQty,
  assertReportQty,
  evaluateReadiness,
  maxOrderQty,
  percentOf,
  planMaterials,
  progressStatus,
  type OrderQtyRow,
  type PlannedMaterial,
} from "./production.planner";

/** Release refused: carries the readiness so the client can show what is missing. */
export class ProductionNotReadyError extends Error {
  constructor(readonly readiness: ProductionReadinessOutDto) {
    super("Project is not ready for production");
  }
}

type LeanOrder = ProductionOrderInterface & { _id: Types.ObjectId };
type LeanReport = ProductionReportInterface & { _id: Types.ObjectId };
type LeanBoq = ProjectShopDrawingBoqInterface & { _id: Types.ObjectId };
type LeanProject = {
  _id: Types.ObjectId;
  name: string;
  projectNumber: string;
  productionReleasedAt?: Date | null;
  productionReleasedBy?: Types.ObjectId | null;
};
type LeanItem = {
  _id: Types.ObjectId;
  code?: string;
  name: string;
  category?: string | null;
};
type FileRef = { id: Types.ObjectId; version: number; originalFilename: string };

/** One live shop drawing item with its current SD file, BOQ and File Produksi. */
type ItemState = {
  item: LeanItem;
  sdFile: FileRef | null;
  boq: LeanBoq | null;
  productionFile: FileRef | null;
};

const ACTIVE_STATUSES: ProductionOrderStatus[] = ["released", "in_progress"];

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function fileRefOut(f: FileRef | null): ProductionOrderFileRefOutDto | null {
  return f
    ? { fileId: String(f.id), version: f.version, originalFilename: f.originalFilename }
    : null;
}

async function allocateOrderNumber(): Promise<string> {
  const parts = projectNumberParts();
  const counter = await ProductionSeqCounterModel.findOneAndUpdate(
    { scopeKey: `spk:${parts.scopeKey}` },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey: `spk:${parts.scopeKey}` } },
    { upsert: true, new: true },
  ).exec();
  if (!counter || counter.nextSeq < 1) {
    throw new Error("Failed to allocate SPK number");
  }
  return `SPK/${parts.roman}/${parts.year}/${String(counter.nextSeq).padStart(4, "0")}`;
}

/** Display name for a user: full name, else email. */
async function userDisplayName(userId: string): Promise<string> {
  const user = await UserModel.findById(userId)
    .select({ fullName: 1, email: 1 })
    .lean()
    .exec();
  if (!user) throw new Error("User not found");
  return user.fullName?.trim() || user.email || "";
}

/** id → full name (email when no full name) for existing users. */
async function userDisplayNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const users = await UserModel.find({
    _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
  })
    .select({ fullName: 1, email: 1 })
    .lean()
    .exec();
  return new Map(
    users.map((u) => [String(u._id), u.fullName?.trim() || u.email || ""]),
  );
}

/** PIC fields for a user id (null clears the PIC). */
async function picFields(
  picUserId: string | null,
): Promise<{ picUserId: Types.ObjectId | null; pic: string }> {
  if (!picUserId) return { picUserId: null, pic: "" };
  const user = await UserModel.findById(picUserId)
    .select({ fullName: 1, email: 1, isBlocked: 1 })
    .lean()
    .exec();
  if (!user) throw new Error("PIC user not found");
  if (user.isBlocked) throw new Error("PIC user is blocked");
  return {
    picUserId: new Types.ObjectId(picUserId),
    pic: user.fullName?.trim() || user.email || "",
  };
}

async function requireProject(projectId: string): Promise<LeanProject> {
  if (!Types.ObjectId.isValid(projectId)) throw new Error("Invalid project id");
  const project = (await ProjectRepo.model
    .findById(projectId)
    .select({ name: 1, projectNumber: 1, productionReleasedAt: 1, productionReleasedBy: 1 })
    .lean()
    .exec()) as LeanProject | null;
  if (!project) throw new Error("Project not found");
  return project;
}

async function loadItemStates(projectId: string): Promise<ItemState[]> {
  const projectOid = new Types.ObjectId(projectId);
  const [items, sdFiles, productionFiles] = await Promise.all([
    ProjectShopDrawingItemRepo.model
      .find({ projectId: projectOid, isDeleted: false })
      .select({ code: 1, name: 1, category: 1 })
      .sort({ code: 1, name: 1 })
      .lean()
      .exec() as Promise<LeanItem[]>,
    ProjectShopDrawingDocumentRepo.model
      .find({ projectId: projectOid, isCurrent: true, isDeleted: { $ne: true } })
      .select({ itemId: 1, version: 1, originalFilename: 1 })
      .lean()
      .exec(),
    ProjectProductionFileRepo.model
      .find({ projectId: projectOid, isCurrent: true, isDeleted: { $ne: true } })
      .select({ itemId: 1, version: 1, originalFilename: 1 })
      .lean()
      .exec(),
  ]);
  const boqs = (await ProjectShopDrawingBoqRepo.model
    .find({ projectId: projectOid, shopDrawingFileId: { $in: sdFiles.map((f) => f._id) } })
    .lean()
    .exec()) as LeanBoq[];

  const sdByItem = new Map(sdFiles.map((f) => [String(f.itemId), f]));
  const prodByItem = new Map(productionFiles.map((f) => [String(f.itemId), f]));
  const boqByFile = new Map(boqs.map((b) => [String(b.shopDrawingFileId), b]));

  return items.map((item) => {
    const sd = sdByItem.get(String(item._id)) ?? null;
    const prod = prodByItem.get(String(item._id)) ?? null;
    return {
      item,
      sdFile: sd
        ? { id: sd._id, version: sd.version, originalFilename: sd.originalFilename }
        : null,
      boq: sd ? (boqByFile.get(String(sd._id)) ?? null) : null,
      productionFile: prod
        ? { id: prod._id, version: prod.version, originalFilename: prod.originalFilename }
        : null,
    };
  });
}

async function itemStateFor(projectId: string, itemId: string): Promise<ItemState> {
  const state = (await loadItemStates(projectId)).find(
    (s) => String(s.item._id) === itemId,
  );
  if (!state) throw new Error("Shop drawing item not found");
  return state;
}

/** Σ non-voided report qty per SPK. */
async function doneByOrder(orderIds: Types.ObjectId[]): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();
  const rows = (await ProductionReportRepo.model
    .find({ productionOrderId: { $in: orderIds }, isVoided: false })
    .select({ productionOrderId: 1, qtyDone: 1 })
    .lean()
    .exec()) as Array<{ productionOrderId: Types.ObjectId; qtyDone: string }>;
  const sums = new Map<string, Decimal>();
  for (const r of rows) {
    const key = String(r.productionOrderId);
    sums.set(key, (sums.get(key) ?? new Decimal(0)).plus(r.qtyDone));
  }
  return new Map([...sums].map(([k, v]) => [k, formatDecimal(v)]));
}

async function ordersForItem(projectId: string, itemId: string): Promise<LeanOrder[]> {
  return (await ProductionOrderRepo.model
    .find({
      projectId: new Types.ObjectId(projectId),
      shopDrawingItemId: new Types.ObjectId(itemId),
    })
    .lean()
    .exec()) as LeanOrder[];
}

function qtyRows(orders: LeanOrder[]): OrderQtyRow[] {
  return orders.map((o) => ({ id: String(o._id), status: o.status, qty: o.qty }));
}

async function requireOrder(id: string): Promise<LeanOrder> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid SPK id");
  const order = (await ProductionOrderRepo.model.findById(id).lean().exec()) as LeanOrder | null;
  if (!order) throw new Error("SPK not found");
  return order;
}

async function materialsOut(rows: PlannedMaterial[]): Promise<ProductionOrderMaterialOutDto[]> {
  const { items, uoms } = await loadItemMeta(rows.map((r) => r.materialItemId));
  return rows
    .map((r) => {
      const item = items.get(r.materialItemId) ?? { code: "—", name: "Unknown" };
      const uom = uoms.get(r.itemUomId) ?? { symbol: "—", name: "—" };
      return {
        materialItemId: r.materialItemId,
        materialCode: item.code,
        materialName: item.name,
        itemUomId: r.itemUomId,
        uomSymbol: uom.symbol,
        qtyPerUnit: r.qtyPerUnit,
        qty: r.qty,
      };
    })
    .sort((a, b) => a.materialName.localeCompare(b.materialName));
}

export class ProductionService {
  async readiness(projectId: string): Promise<ProductionReadinessOutDto> {
    const project = await requireProject(projectId);
    const projectOid = new Types.ObjectId(projectId);
    const [won, rab, change, states] = await Promise.all([
      ProjectQuotationRepo.model
        .findOne({ projectId: projectOid, status: "won" })
        .select({ revision: 1, quotationNumber: 1 })
        .lean()
        .exec(),
      ProjectRabRepo.model.findOne({ projectId: projectOid }).select({ status: 1 }).lean().exec(),
      projectRabChangeService.findOpenDraft(projectId),
      loadItemStates(projectId),
    ]);

    const result = evaluateReadiness({
      wonQuotation: won
        ? { revision: won.revision, quotationNumber: won.quotationNumber }
        : null,
      rabStatus: rab ? rab.status : "none",
      rabChangeOpen: Boolean(change),
      items: states.map((s) => ({
        itemId: String(s.item._id),
        code: s.item.code ?? "",
        name: s.item.name,
        label: shopDrawingItemLabel(s.item),
        hasShopDrawing: s.sdFile !== null,
        hasBoq: s.boq !== null,
        makeQty: s.boq?.makeQty ?? null,
        hasProductionFile: s.productionFile !== null,
      })),
    });

    const releasedById = project.productionReleasedBy
      ? String(project.productionReleasedBy)
      : null;
    const names = await userEmailsById(releasedById ? [releasedById] : []);
    return {
      projectId,
      ready: result.ready,
      releasedAt: iso(project.productionReleasedAt),
      releasedBy: releasedById
        ? { id: releasedById, name: names.get(releasedById) ?? releasedById }
        : null,
      checks: result.checks,
      items: result.items,
      readyCount: result.readyCount,
      totalCount: result.items.length,
    };
  }

  /** Hand the project over to production; refused (with the gaps) unless every check passes. */
  async release(projectId: string, userId: string): Promise<ProductionReadinessOutDto> {
    const project = await requireProject(projectId);
    if (project.productionReleasedAt) {
      throw new Error("Project is already released to production");
    }
    const readiness = await this.readiness(projectId);
    if (!readiness.ready) throw new ProductionNotReadyError(readiness);
    await ProjectRepo.findByIdAndUpdate(projectId, {
      $set: {
        productionReleasedAt: new Date(),
        productionReleasedBy: new Types.ObjectId(userId),
        status: "win",
        loseReason: null,
        closeReason: null,
      },
    });
    return this.readiness(projectId);
  }

  async progress(projectId: string): Promise<ProductionProjectProgressOutDto> {
    const project = await requireProject(projectId);
    const [states, orders] = await Promise.all([
      loadItemStates(projectId),
      ProductionOrderRepo.model
        .find({ projectId: new Types.ObjectId(projectId) })
        .lean()
        .exec() as Promise<LeanOrder[]>,
    ]);
    const done = await doneByOrder(orders.map((o) => o._id));

    let totalMake = new Decimal(0);
    let totalDone = new Decimal(0);
    const items = states.map((s): ProductionItemProgressOutDto => {
      const itemId = String(s.item._id);
      const itemOrders = orders.filter((o) => String(o.shopDrawingItemId) === itemId);
      // Released SPKs remember makeQty; fall back to the live BOQ.
      const makeQty = s.boq?.makeQty ?? itemOrders.find((o) => o.snapshot)?.snapshot?.makeQty ?? "0";
      const max = maxOrderQty(makeQty, qtyRows(itemOrders), done);
      const orderedQty = new Decimal(makeQty).minus(max);
      const doneQty = itemOrders
        .filter((o) => o.status !== "cancelled")
        .reduce((sum, o) => sum.plus(done.get(String(o._id)) ?? "0"), new Decimal(0));
      totalMake = totalMake.plus(makeQty);
      totalDone = totalDone.plus(doneQty);
      const ordered = formatDecimal(orderedQty);
      const doneText = formatDecimal(doneQty);
      return {
        itemId,
        code: s.item.code ?? "",
        name: s.item.name,
        label: shopDrawingItemLabel(s.item),
        category: s.item.category ?? null,
        makeQty,
        orderedQty: ordered,
        doneQty: doneText,
        remainingToOrder: formatDecimal(max),
        percent: percentOf(doneText, makeQty),
        status: progressStatus({ makeQty, orderedQty: ordered, doneQty: doneText }),
        orderCount: itemOrders.filter((o) => o.status !== "cancelled").length,
      };
    });

    const makeText = formatDecimal(totalMake);
    const doneText = formatDecimal(totalDone);
    return {
      projectId,
      releasedAt: iso(project.productionReleasedAt),
      items,
      totals: { makeQty: makeText, doneQty: doneText, percent: percentOf(doneText, makeText) },
    };
  }

  /** Active users that can be picked as SPK person in charge. */
  async listPicUsers(): Promise<ProductionPicUserOutDto[]> {
    const users = await UserModel.find({ isBlocked: { $ne: true } })
      .select({ fullName: 1, email: 1 })
      .sort({ fullName: 1, email: 1 })
      .lean()
      .exec();
    return users.map((u) => ({
      id: String(u._id),
      name: u.fullName?.trim() || u.email || "",
      email: u.email ?? "",
    }));
  }

  /**
   * `assignedTo` limits the list to SPKs where that user is PIC (drafts are
   * not handed out yet, so they are left out too).
   */
  async listOrders(filter: {
    projectId?: string;
    status?: ProductionOrderStatusDto;
    q?: string;
    assignedTo?: string;
  }): Promise<ProductionOrderSummaryOutDto[]> {
    const query: Record<string, unknown> = {};
    if (filter.projectId) {
      if (!Types.ObjectId.isValid(filter.projectId)) throw new Error("Invalid project id");
      query.projectId = new Types.ObjectId(filter.projectId);
    }
    if (filter.assignedTo) {
      query.picUserId = new Types.ObjectId(filter.assignedTo);
      query.status = filter.status && filter.status !== "draft"
        ? filter.status
        : { $ne: "draft" };
      if (filter.status === "draft") return [];
    } else if (filter.status) {
      query.status = filter.status;
    }
    const orders = (await ProductionOrderRepo.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec()) as LeanOrder[];
    const rows = await this.summaries(orders);
    const q = filter.q?.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.projectNumber, r.projectName, r.itemLabel, r.pic]
        .some((v) => v.toLowerCase().includes(q)),
    );
  }

  async getOrder(id: string): Promise<ProductionOrderOutDto> {
    const order = await requireOrder(id);
    const projectId = String(order.projectId);
    const itemId = String(order.shopDrawingItemId);
    const [summary] = await this.summaries([order]);
    const reports = (await ProductionReportRepo.model
      .find({ productionOrderId: order._id })
      .sort({ reportDate: -1, createdAt: -1 })
      .lean()
      .exec()) as LeanReport[];

    let makeQty: string;
    let planned: PlannedMaterial[];
    let sdFile: FileRef | null;
    let productionFile: FileRef | null;
    if (order.snapshot) {
      const snap = order.snapshot;
      makeQty = snap.makeQty;
      planned = snap.materials.map((m) => ({
        materialItemId: String(m.materialItemId),
        itemUomId: String(m.itemUomId),
        qtyPerUnit: m.qtyPerUnit,
        qty: m.qty,
      }));
      const [sd, prod] = await Promise.all([
        ProjectShopDrawingDocumentRepo.model
          .findById(snap.shopDrawingFileId)
          .select({ originalFilename: 1 })
          .lean()
          .exec(),
        ProjectProductionFileRepo.model
          .findById(snap.productionFileId)
          .select({ originalFilename: 1 })
          .lean()
          .exec(),
      ]);
      sdFile = {
        id: snap.shopDrawingFileId,
        version: snap.shopDrawingFileVersion,
        originalFilename: sd?.originalFilename ?? "(deleted)",
      };
      productionFile = {
        id: snap.productionFileId,
        version: snap.productionFileVersion,
        originalFilename: prod?.originalFilename ?? "(deleted)",
      };
    } else {
      const state = await itemStateFor(projectId, itemId).catch(() => null);
      makeQty = state?.boq?.makeQty ?? "0";
      planned = state?.boq ? planMaterials(state.boq, order.qty) : [];
      sdFile = state?.sdFile ?? null;
      productionFile = state?.productionFile ?? null;
    }

    const siblings = await ordersForItem(projectId, itemId);
    const done = await doneByOrder(siblings.map((o) => o._id));
    const max = maxOrderQty(makeQty, qtyRows(siblings), done, String(order._id));

    const userIds = [
      order.createdBy,
      order.releasedBy,
      order.completedBy,
      order.cancelledBy,
      ...reports.flatMap((r) => [r.reportedBy, r.voidedBy]),
    ]
      .filter(Boolean)
      .map(String);
    const names = await userEmailsById(userIds);
    const ref = (oid: Types.ObjectId | null | undefined): ProjectRabUserRefOutDto | null =>
      oid ? { id: String(oid), name: names.get(String(oid)) ?? String(oid) } : null;

    return {
      ...summary!,
      notes: order.notes ?? "",
      createdBy: ref(order.createdBy),
      releasedBy: ref(order.releasedBy),
      releasedByName: order.releasedByName ?? "",
      completedBy: ref(order.completedBy),
      completeNote: order.completeNote ?? "",
      cancelledAt: iso(order.cancelledAt),
      cancelledBy: ref(order.cancelledBy),
      cancelReason: order.cancelReason ?? "",
      makeQty,
      materials: await materialsOut(planned),
      shopDrawingFile: fileRefOut(sdFile),
      productionFile: fileRefOut(productionFile),
      maxQty: formatDecimal(max),
      reports: reports.map((r): ProductionReportOutDto => ({
        id: String(r._id),
        productionOrderId: String(r.productionOrderId),
        qtyDone: r.qtyDone,
        reportDate: r.reportDate,
        notes: r.notes ?? "",
        reportedBy: ref(r.reportedBy),
        createdAt: iso(r.createdAt),
        isVoided: r.isVoided === true,
        voidedAt: iso(r.voidedAt),
        voidedBy: ref(r.voidedBy),
        voidReason: r.voidReason ?? "",
      })),
    };
  }

  async createOrder(
    input: CreateProductionOrderInDto,
    userId: string,
  ): Promise<ProductionOrderOutDto> {
    const project = await requireProject(input.projectId);
    if (!project.productionReleasedAt) {
      throw new Error("Release the project to production before creating an SPK");
    }
    const state = await itemStateFor(input.projectId, input.shopDrawingItemId);
    if (!state.boq) throw new Error("This item has no BOQ");

    const created = await withTx(async () => {
      const siblings = await ordersForItem(input.projectId, input.shopDrawingItemId);
      const done = await doneByOrder(siblings.map((o) => o._id));
      assertOrderQty(input.qty, maxOrderQty(state.boq!.makeQty, qtyRows(siblings), done));
      return ProductionOrderRepo.create({
        projectId: new Types.ObjectId(input.projectId),
        shopDrawingItemId: new Types.ObjectId(input.shopDrawingItemId),
        number: await allocateOrderNumber(),
        type: "inhouse",
        qty: input.qty,
        status: "draft",
        plannedStart: input.plannedStart,
        plannedFinish: input.plannedFinish,
        ...(await picFields(input.picUserId)),
        notes: input.notes,
        snapshot: null,
        createdBy: new Types.ObjectId(userId),
      });
    });
    return this.getOrder(String(created._id));
  }

  async updateOrder(
    id: string,
    input: UpdateProductionOrderInDto,
  ): Promise<ProductionOrderOutDto> {
    const order = await requireOrder(id);
    if (order.status !== "draft") throw new Error("Only a draft SPK can be edited");
    const start = input.plannedStart !== undefined ? input.plannedStart : order.plannedStart ?? null;
    const finish = input.plannedFinish !== undefined ? input.plannedFinish : order.plannedFinish ?? null;
    if (start && finish && finish < start) {
      throw new Error("plannedFinish cannot be before plannedStart");
    }
    if (input.qty !== undefined) {
      const projectId = String(order.projectId);
      const itemId = String(order.shopDrawingItemId);
      const state = await itemStateFor(projectId, itemId);
      if (!state.boq) throw new Error("This item has no BOQ");
      const siblings = await ordersForItem(projectId, itemId);
      const done = await doneByOrder(siblings.map((o) => o._id));
      assertOrderQty(
        input.qty,
        maxOrderQty(state.boq.makeQty, qtyRows(siblings), done, id),
      );
    }
    await ProductionOrderRepo.findOneAndUpdate(
      { _id: order._id, status: "draft" },
      {
        $set: {
          ...(input.qty !== undefined ? { qty: input.qty } : {}),
          ...(input.plannedStart !== undefined ? { plannedStart: input.plannedStart } : {}),
          ...(input.plannedFinish !== undefined ? { plannedFinish: input.plannedFinish } : {}),
          ...(input.picUserId !== undefined
            ? await picFields(input.picUserId)
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      },
    );
    return this.getOrder(id);
  }

  async deleteOrder(id: string): Promise<void> {
    const order = await requireOrder(id);
    if (order.status !== "draft") {
      throw new Error("Only a draft SPK can be deleted; cancel a released one");
    }
    const removed = await ProductionOrderRepo.deleteOne({ _id: order._id, status: "draft" });
    if (!removed) throw new Error("SPK not found");
  }

  /** Freeze makeQty, files and materials onto the SPK and hand it to the floor. */
  async releaseOrder(id: string, userId: string): Promise<ProductionOrderOutDto> {
    const order = await requireOrder(id);
    if (order.status !== "draft") throw new Error("Only a draft SPK can be released");
    const projectId = String(order.projectId);
    const itemId = String(order.shopDrawingItemId);
    const state = await itemStateFor(projectId, itemId);
    const missing = [
      !state.sdFile && "shop drawing file",
      !state.boq && "BOQ",
      !state.productionFile && "File Produksi",
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(`Cannot release: this item has no ${missing.join(", ")}`);
    }
    const boq = state.boq!;
    const siblings = await ordersForItem(projectId, itemId);
    const done = await doneByOrder(siblings.map((o) => o._id));
    assertOrderQty(order.qty, maxOrderQty(boq.makeQty, qtyRows(siblings), done, id));

    const materials = planMaterials(boq, order.qty);
    const updated = await ProductionOrderRepo.findOneAndUpdate(
      { _id: order._id, status: "draft" },
      {
        $set: {
          status: "released",
          releasedAt: new Date(),
          releasedBy: new Types.ObjectId(userId),
          releasedByName: await userDisplayName(userId),
          snapshot: {
            makeQty: boq.makeQty,
            boqId: boq._id,
            shopDrawingFileId: state.sdFile!.id,
            shopDrawingFileVersion: state.sdFile!.version,
            productionFileId: state.productionFile!.id,
            productionFileVersion: state.productionFile!.version,
            materials: materials.map((m) => ({
              materialItemId: new Types.ObjectId(m.materialItemId),
              itemUomId: new Types.ObjectId(m.itemUomId),
              qtyPerUnit: m.qtyPerUnit,
              qty: m.qty,
            })),
          },
        },
      },
    );
    if (!updated) throw new Error("Failed to release SPK");
    return this.getOrder(id);
  }

  async completeOrder(id: string, userId: string, note: string): Promise<ProductionOrderOutDto> {
    const order = await requireOrder(id);
    if (!ACTIVE_STATUSES.includes(order.status)) {
      throw new Error("Only a released or in-progress SPK can be completed");
    }
    const done = new Decimal((await doneByOrder([order._id])).get(id) ?? "0");
    if (done.lte(0)) {
      throw new Error("Nothing has been reported on this SPK: cancel it instead");
    }
    if (done.lt(order.qty) && !note.trim()) {
      throw new Error(
        `Only ${formatDecimal(done)} of ${order.qty} finished: add a note to close it short`,
      );
    }
    const updated = await ProductionOrderRepo.findOneAndUpdate(
      { _id: order._id, status: { $in: ACTIVE_STATUSES } },
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          completedBy: new Types.ObjectId(userId),
          completeNote: note.trim(),
        },
      },
    );
    if (!updated) throw new Error("Failed to complete SPK");
    return this.getOrder(id);
  }

  async cancelOrder(id: string, userId: string, reason: string): Promise<ProductionOrderOutDto> {
    const order = await requireOrder(id);
    if (!ACTIVE_STATUSES.includes(order.status)) {
      throw new Error("Only a released or in-progress SPK can be cancelled");
    }
    const done = new Decimal((await doneByOrder([order._id])).get(id) ?? "0");
    if (done.gt(0)) {
      throw new Error("This SPK has production reports: complete it (short) instead");
    }
    const updated = await ProductionOrderRepo.findOneAndUpdate(
      { _id: order._id, status: { $in: ACTIVE_STATUSES } },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledBy: new Types.ObjectId(userId),
          cancelReason: reason,
        },
      },
    );
    if (!updated) throw new Error("Failed to cancel SPK");
    return this.getOrder(id);
  }

  async addReport(
    orderId: string,
    input: CreateProductionReportInDto,
    userId: string,
  ): Promise<ProductionOrderOutDto> {
    const order = await requireOrder(orderId);
    if (!ACTIVE_STATUSES.includes(order.status)) {
      throw new Error("Reports can only be added to a released or in-progress SPK");
    }
    if (input.reportDate > jakartaYmdString()) {
      throw new Error("reportDate cannot be in the future");
    }
    await withTx(async () => {
      const already = (await doneByOrder([order._id])).get(orderId) ?? "0";
      assertReportQty(input.qtyDone, order.qty, already);
      await ProductionReportRepo.create({
        projectId: order.projectId,
        productionOrderId: order._id,
        shopDrawingItemId: order.shopDrawingItemId,
        qtyDone: input.qtyDone,
        reportDate: input.reportDate,
        notes: input.notes,
        reportedBy: new Types.ObjectId(userId),
        isVoided: false,
      });
      if (order.status === "released") {
        await ProductionOrderRepo.findOneAndUpdate(
          { _id: order._id, status: "released" },
          { $set: { status: "in_progress" } },
        );
      }
    });
    return this.getOrder(orderId);
  }

  async voidReport(reportId: string, userId: string, reason: string): Promise<ProductionOrderOutDto> {
    if (!Types.ObjectId.isValid(reportId)) throw new Error("Invalid report id");
    const report = (await ProductionReportRepo.model.findById(reportId).lean().exec()) as LeanReport | null;
    if (!report) throw new Error("Report not found");
    if (report.isVoided) throw new Error("Report is already voided");
    const order = await requireOrder(String(report.productionOrderId));
    if (!ACTIVE_STATUSES.includes(order.status)) {
      throw new Error("Reports on a completed or cancelled SPK cannot be voided");
    }
    const updated = await ProductionReportRepo.findOneAndUpdate(
      { _id: report._id, isVoided: false },
      {
        $set: {
          isVoided: true,
          voidedAt: new Date(),
          voidedBy: new Types.ObjectId(userId),
          voidReason: reason,
        },
      },
    );
    if (!updated) throw new Error("Failed to void report");
    return this.getOrder(String(order._id));
  }

  private async summaries(orders: LeanOrder[]): Promise<ProductionOrderSummaryOutDto[]> {
    if (orders.length === 0) return [];
    const projectIds = [...new Set(orders.map((o) => String(o.projectId)))];
    const itemIds = [...new Set(orders.map((o) => String(o.shopDrawingItemId)))];
    const picIds = [
      ...new Set(orders.flatMap((o) => (o.picUserId ? [String(o.picUserId)] : []))),
    ];
    const [projects, items, done, picNames] = await Promise.all([
      ProjectRepo.model
        .find({ _id: { $in: projectIds.map((id) => new Types.ObjectId(id)) } })
        .select({ name: 1, projectNumber: 1 })
        .lean()
        .exec(),
      ProjectShopDrawingItemRepo.model
        .find({ _id: { $in: itemIds.map((id) => new Types.ObjectId(id)) } })
        .select({ code: 1, name: 1 })
        .lean()
        .exec(),
      doneByOrder(orders.map((o) => o._id)),
      userDisplayNames(picIds),
    ]);
    const projectById = new Map(projects.map((p) => [String(p._id), p]));
    const itemById = new Map(items.map((i) => [String(i._id), i]));
    return orders.map((o) => {
      const project = projectById.get(String(o.projectId));
      const item = itemById.get(String(o.shopDrawingItemId));
      return {
        id: String(o._id),
        number: o.number,
        type: o.type,
        status: o.status,
        projectId: String(o.projectId),
        projectNumber: project?.projectNumber ?? "—",
        projectName: project?.name ?? "Unknown project",
        shopDrawingItemId: String(o.shopDrawingItemId),
        itemLabel: item ? shopDrawingItemLabel(item) : "Deleted item",
        qty: o.qty,
        doneQty: done.get(String(o._id)) ?? "0",
        plannedStart: o.plannedStart ?? null,
        plannedFinish: o.plannedFinish ?? null,
        picUserId: o.picUserId ? String(o.picUserId) : null,
        // Live name so a full name added later shows up; snapshot if the user is gone.
        pic: (o.picUserId && picNames.get(String(o.picUserId))) || o.pic || "",
        createdAt: iso(o.createdAt),
        releasedAt: iso(o.releasedAt),
        completedAt: iso(o.completedAt),
      };
    });
  }
}

export const productionService = new ProductionService();

const PRODUCTION_TYPE_LABELS: Record<string, string> = {
  inhouse: "Inhouse",
  subcon: "Subcon",
  outsource: "Outsource",
};

/** Company profile logo from Admin › Config (live, not a snapshot). */
export async function loadCompanyLogo(): Promise<QuotationLogo | null> {
  const id = appConfigService.companyProfile;
  if (!id) return null;
  try {
    const file = await findFile("public", id);
    if (!file) return null;
    const contentType =
      typeof file.metadata?.contentType === "string"
        ? file.metadata.contentType
        : "application/octet-stream";
    return { buffer: await readFileBuffer("public", id), contentType };
  } catch (error) {
    logger.warn(
      error instanceof Error ? error.message : String(error),
      "modules/production/production.service.ts",
      "loadCompanyLogo",
    );
    return null;
  }
}

/** Company name and address lines for printed documents (Admin › Config). */
export function companyLetterhead(): { companyName: string; letterhead: string[] } {
  const config = appConfigService.getAppConfig();
  const branches = (config.branchOfficeAddresses ?? [])
    .map(splitLines)
    .filter((lines) => lines.length > 0);
  const labelled = (label: string, lines: string[]) =>
    lines.map((l, i) => (i === 0 ? `${label}: ${l}` : l));
  const letterhead = [
    ...(branches.length > 0
      ? [
          ...labelled("Head Office", splitLines(config.address)),
          ...branches.flatMap((lines) => labelled("Branch Office", lines)),
        ]
      : splitLines(config.address)),
    [config.phone && `Telp: ${config.phone}`, config.email].filter(Boolean).join(" · "),
    config.website,
  ].filter((line): line is string => Boolean(line));
  return { companyName: config.companyName, letterhead };
}

export function ymdLong(ymd: string | null): string {
  return ymd ? formatLongDate(new Date(`${ymd}T00:00:00+07:00`)) : "-";
}

/** SPK as a printable PDF; drafts print as DRAFT with no issuer signature. */
export async function exportProductionOrderPdf(
  id: string,
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const order = await productionService.getOrder(id);
  const [project, item] = await Promise.all([
    ProjectRepo.model
      .findById(order.projectId)
      .select({ name: 1, projectNumber: 1, customerId: 1 })
      .lean()
      .exec(),
    ProjectShopDrawingItemRepo.model
      .findById(order.shopDrawingItemId)
      .select({ code: 1, name: 1, dimension: 1, descriptions: 1 })
      .lean()
      .exec(),
  ]);
  const customer = project
    ? await CustomerRepo.model.findById(project.customerId).select({ name: 1 }).lean().exec()
    : null;

  const { companyName, letterhead } = companyLetterhead();

  const isDraft = order.status === "draft";
  const issuedAt = order.releasedAt ? new Date(order.releasedAt) : new Date();
  const fileRow = (
    label: string,
    kind: "sd" | "production",
    f: ProductionOrderOutDto["shopDrawingFile"],
  ): SpkPdfData["files"][number] => {
    if (!f) return { label, text: "-", url: null };
    const qs = new URLSearchParams({
      projectId: order.projectId,
      kind,
      fileId: f.fileId,
      name: f.originalFilename,
    });
    return {
      label,
      text: `v${f.version} · ${f.originalFilename}`,
      url: `${env.frontendUrl.replace(/\/+$/, "")}/dashboard/production/file?${qs.toString()}`,
    };
  };
  const issuerLive = order.releasedBy
    ? (await userDisplayNames([order.releasedBy.id])).get(order.releasedBy.id)
    : undefined;

  const data: SpkPdfData = {
    companyName,
    letterhead,
    title: `SURAT PERINTAH KERJA PRODUKSI${isDraft ? " (DRAFT)" : ""}`,
    meta: {
      left: [
        ["Proyek", order.projectNumber],
        ["Nama Proyek", order.projectName],
        ["Customer", customer?.name ?? "-"],
      ],
      right: [
        ["No. SPK", order.number],
        ["Tanggal", formatLongDate(issuedAt)],
        ["Jenis", PRODUCTION_TYPE_LABELS[order.type] ?? order.type],
        ["Status", isDraft ? "Draft" : order.status === "cancelled" ? "Dibatalkan" : "Dirilis"],
      ],
    },
    item: {
      code: item?.code ?? "",
      name: item?.name ?? order.itemLabel,
      descriptions: item?.descriptions ?? [],
      dimension: item?.dimension ?? "",
      qty: order.qty,
    },
    schedule: [
      ["Rencana mulai", ymdLong(order.plannedStart)],
      ["Rencana selesai", ymdLong(order.plannedFinish)],
      ["PIC", order.pic || "-"],
    ],
    files: [
      fileRow("Shop drawing", "sd", order.shopDrawingFile),
      fileRow("File Produksi", "production", order.productionFile),
    ],
    materials: order.materials.map((m) => ({
      code: m.materialCode,
      name: m.materialName,
      perUnit: m.qtyPerUnit,
      total: m.qty,
      uom: m.uomSymbol,
    })),
    notes: splitLines(order.notes),
    signDate: formatLongDate(issuedAt),
    issuerName: isDraft
      ? null
      : issuerLive || order.releasedByName || order.releasedBy?.name || null,
    picName: order.pic || null,
  };

  const filename = [
    "SPK",
    safeFilenamePart(order.number),
    isDraft ? "DRAFT" : null,
    formatExportYmd(),
  ]
    .filter(Boolean)
    .join("_");
  return {
    buffer: await buildSpkPdf(data, await loadCompanyLogo()),
    filename: `${filename}.pdf`,
    contentType: "application/pdf",
  };
}
