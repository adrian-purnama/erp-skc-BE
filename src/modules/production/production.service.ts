import Decimal from "decimal.js";
import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import type {
  CreateProductionOrderInDto,
  CreateProductionReportInDto,
  ProductionItemProgressOutDto,
  ProductionLabourStageOutDto,
  ProductionOrderFileRefOutDto,
  ProductionOrderMaterialOutDto,
  ProductionOrderOutDto,
  ProductionOrderStatusDto,
  ProductionOrderSummaryOutDto,
  ProductionOrderPurchaseOutDto,
  ProductionPicUserOutDto,
  ProductionProjectProgressOutDto,
  ProductionReadinessOutDto,
  ProductionReportOutDto,
  UpdateProductionOrderInDto,
} from "../../dto/production.dto";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import { ProjectRepo } from "../../models/project.model";
import {
  ProductionOrderRepo,
  type ProductionOrderInterface,
  type ProductionOrderLabourStage,
  type ProductionOrderSnapshot,
  type ProductionOrderStatus,
} from "../../models/productionOrder.model";
import {
  ProductionReportRepo,
  type ProductionReportInterface,
} from "../../models/productionReport.model";
import { ProductionHandoverRepo } from "../../models/productionHandover.model";
import { MaterialDispatchRepo } from "../../models/materialDispatch.model";
import { ProjectProductionFileRepo } from "../../models/projectProductionFile.model";
import {
  PURCHASE_ORDER_LIVE_STATUSES,
  PurchaseOrderRepo,
} from "../../models/purchaseOrder.model";
import {
  PurchaseRequestRepo,
  type PurchaseRequestStatus,
} from "../../models/purchaseRequest.model";
import { ProjectQuotationRepo } from "../../models/projectQuotation.model";
import { ProjectRabRepo } from "../../models/projectRab.model";
import {
  ProjectShopDrawingBoqRepo,
  type ProjectShopDrawingBoqInterface,
} from "../../models/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument.model";
import {
  ProjectShopDrawingItemRepo,
  type ShopDrawingMakeType,
} from "../../models/projectShopDrawingItem.model";
import { ProductionSeqCounterModel } from "../../models/seqCounter.model";
import { UserModel } from "../../models/user.model";
import { CustomerRepo } from "../../models/customer.model";
import { VendorRepo } from "../../models/vendor.model";
import { findFile, readFileBuffer } from "../../core/gridfs";
import { logger } from "../../core/logger";
import { appConfigService } from "../appConfig/AppConfig.service";
import { env } from "../../core/env";
import {
  formatExportYmd,
  safeFilenamePart,
} from "../project/projectRabExport.planner";
import { formatLongDate, splitLines } from "../quotation/quotation.document";
import type { QuotationLogo } from "../quotation/quotation.logo";
import { buildSpkPdf, type SpkPdfData } from "./production.pdf";
import { jakartaYmdString, userEmailsById } from "../../utils/shared";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { labourItemIds, loadItemMeta } from "../itemMaster/itemMeta";
import { projectNumberParts } from "../project/projectNumber";
import { projectRabChangeService } from "../project/projectRabChange.service";
import { shopDrawingItemLabel } from "../project/projectShared";
import { loadShopDrawingSpecs } from "../project/projectShopDrawingSpec";
import { handoversOut, hasVendorFee, vendorFeesOut } from "./vendorWork";
import { subconDispatchOut } from "./materialDispatch.queries";
import {
  DEFAULT_HANDOVER_CHECKLIST,
  assertLabourStagesForRelease,
  assertOrderQty,
  assertReportQty,
  assertStageReportQty,
  evaluateReadiness,
  finishedQty,
  maxOrderQty,
  needsProductionFile,
  percentOf,
  planFeeLines,
  planMaterials,
  qtyByStage,
  scaleMaterials,
  progressStatus,
  weightedProgressPercent,
  type OrderQtyRow,
  type PlannedMaterial,
  type PriorMaterialIssue,
} from "./production.planner";
import { loadRabUomPlan } from "../project/projectRabUomPlan";
import { isLabourLine, rabLineKey } from "../project/projectRab.planner";

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
  makeType?: ShopDrawingMakeType;
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
/** Draft plus active: PIC, dates and notes can still be amended. */
const EDITABLE_STATUSES: ProductionOrderStatus[] = ["draft", ...ACTIVE_STATUSES];
const LIVE_PURCHASE_REQUEST_STATUSES: PurchaseRequestStatus[] = ["draft", "submitted"];

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
      .select({ code: 1, name: 1, category: 1, makeType: 1 })
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

type OrderProgress = {
  doneQty: string;
  progressPercent: number;
  byStage: Map<number, string>;
};

/**
 * Finished pcs + weighted % per SPK.
 * Staged inhouse: doneQty = last stage; % = weighted stages.
 * Legacy / vendor: doneQty = Σ qtyDone; % = done/qty.
 */
async function progressByOrder(
  orders: Array<{
    _id: Types.ObjectId;
    qty: string;
    snapshot?: ProductionOrderSnapshot | null;
  }>,
): Promise<Map<string, OrderProgress>> {
  const out = new Map<string, OrderProgress>();
  if (orders.length === 0) return out;
  const orderIds = orders.map((o) => o._id);
  const rows = (await ProductionReportRepo.model
    .find({ productionOrderId: { $in: orderIds }, isVoided: false })
    .select({ productionOrderId: 1, qtyDone: 1, stageSequence: 1 })
    .lean()
    .exec()) as Array<{
    productionOrderId: Types.ObjectId;
    qtyDone: string;
    stageSequence?: number | null;
  }>;
  const reportsByOrder = new Map<
    string,
    Array<{ qtyDone: string; stageSequence?: number | null }>
  >();
  for (const r of rows) {
    const key = String(r.productionOrderId);
    const list = reportsByOrder.get(key) ?? [];
    list.push({ qtyDone: r.qtyDone, stageSequence: r.stageSequence });
    reportsByOrder.set(key, list);
  }
  for (const o of orders) {
    const id = String(o._id);
    const stages = o.snapshot?.labourStages ?? [];
    const reports = reportsByOrder.get(id) ?? [];
    if (stages.length > 0) {
      const byStage = qtyByStage(reports, stages);
      out.set(id, {
        doneQty: finishedQty(stages, byStage),
        progressPercent: weightedProgressPercent(o.qty, stages, byStage),
        byStage,
      });
    } else {
      const sum = reports.reduce(
        (acc, r) => acc.plus(r.qtyDone),
        new Decimal(0),
      );
      const doneQty = formatDecimal(sum);
      out.set(id, {
        doneQty,
        progressPercent: percentOf(doneQty, o.qty),
        byStage: new Map(),
      });
    }
  }
  return out;
}

/** Finished pcs only (allocation / complete / cancel). */
async function doneByOrder(
  orderIds: Types.ObjectId[],
): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();
  const orders = (await ProductionOrderRepo.model
    .find({ _id: { $in: orderIds } })
    .select({ qty: 1, snapshot: 1 })
    .lean()
    .exec()) as Array<{
    _id: Types.ObjectId;
    qty: string;
    snapshot?: ProductionOrderSnapshot | null;
  }>;
  const progress = await progressByOrder(orders);
  return new Map([...progress].map(([k, v]) => [k, v.doneQty]));
}

/** RAB labour on a drawing, ready to freeze as inhouse stages. */
async function itemLabourStagesForRelease(
  projectId: string,
  itemId: string,
): Promise<ProductionOrderLabourStage[]> {
  const rab = await ProjectRabRepo.model
    .findOne({ projectId: new Types.ObjectId(projectId) })
    .select({ lines: 1 })
    .lean()
    .exec();
  const lines = (rab?.lines ?? []).filter(
    (l) =>
      isLabourLine(l) &&
      l.shopDrawingItemId !== undefined &&
      String(l.shopDrawingItemId) === itemId,
  );
  if (lines.length === 0) {
    throw new Error(
      "Cannot release: add inhouse labour stages on this item's RAB (sequence + weight %) first",
    );
  }
  const missing = lines.filter(
    (l) => l.sequence == null || l.weightPercent == null,
  );
  if (missing.length > 0) {
    throw new Error(
      "Cannot release: set process order and weight % on every labour line for this item",
    );
  }
  const sorted = [...lines].sort((a, b) => a.sequence! - b.sequence!);
  assertLabourStagesForRelease(
    sorted.map((l) => ({
      sequence: l.sequence!,
      weightPercent: l.weightPercent!,
    })),
  );
  const itemIds = sorted.map((l) => String(l.materialItemId));
  const { items } = await loadItemMeta(itemIds);
  return sorted.map((l) => {
    const id = String(l.materialItemId);
    const meta = items.get(id);
    return {
      materialItemId: l.materialItemId,
      itemUomId: l.itemUomId,
      name: meta?.name?.trim() || meta?.code || "Labour",
      sequence: l.sequence!,
      weightPercent: l.weightPercent!,
    };
  });
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

/**
 * RAB rounding rules for the item's BOQ plus what its other released SPKs
 * already planned per material, for cumulative rounding.
 */
async function materialOptions(
  boq: LeanBoq,
  siblings: LeanOrder[],
  exceptId: string,
): Promise<{ plan: Awaited<ReturnType<typeof loadRabUomPlan>>; prior: Map<string, PriorMaterialIssue> }> {
  const plan = await loadRabUomPlan([boq]);
  const prior = new Map<string, PriorMaterialIssue>();
  for (const o of siblings) {
    if (String(o._id) === exceptId || !o.snapshot || o.status === "cancelled") continue;
    for (const m of o.snapshot.materials) {
      const key = rabLineKey(String(m.materialItemId), String(m.itemUomId));
      const p = prior.get(key);
      prior.set(key, {
        exactQty: formatDecimal(new Decimal(p?.exactQty ?? 0).plus(m.exactQty ?? m.qty)),
        qty: formatDecimal(new Decimal(p?.qty ?? 0).plus(m.qty)),
      });
    }
  }
  return { plan, prior };
}

function qtyRows(orders: LeanOrder[]): OrderQtyRow[] {
  return orders.map((o) => ({ id: String(o._id), status: o.status, qty: o.qty }));
}

/** Refuse when output was reported or material was requested against the SPK. */
async function assertNoOrderActivity(order: LeanOrder, action: string): Promise<void> {
  const [reports, handovers, requests, purchaseOrders] = await Promise.all([
    ProductionReportRepo.model.countDocuments({ productionOrderId: order._id }).exec(),
    ProductionHandoverRepo.model.countDocuments({ productionOrderId: order._id }).exec(),
    PurchaseRequestRepo.model
      .countDocuments({
        productionOrderId: order._id,
        status: { $in: LIVE_PURCHASE_REQUEST_STATUSES },
      })
      .exec(),
    PurchaseOrderRepo.model
      .countDocuments({
        "lines.productionOrderId": order._id,
        status: { $in: PURCHASE_ORDER_LIVE_STATUSES },
      })
      .exec(),
  ]);
  if (reports > 0) {
    throw new Error(`Cannot ${action}: this SPK has production reports`);
  }
  if (handovers > 0) {
    throw new Error(`Cannot ${action}: this SPK has vendor handovers`);
  }
  if (requests + purchaseOrders > 0) {
    throw new Error(
      `Cannot ${action}: material was requested on this SPK; cancel its SPP / PO first`,
    );
  }
}

/**
 * A closed SPK takes no more handovers or surat jalan, so open ones must be
 * finished or removed first.
 */
async function assertNoDraftHandovers(order: LeanOrder, action: string): Promise<void> {
  const [drafts, openDispatches] = await Promise.all([
    ProductionHandoverRepo.model.countDocuments({ productionOrderId: order._id, status: "draft" }).exec(),
    MaterialDispatchRepo.model
      .countDocuments({
        productionOrderId: order._id,
        status: { $in: ["draft", "pending_approval", "approved", "rejected"] },
      })
      .exec(),
  ]);
  if (drafts > 0) {
    throw new Error(`Cannot ${action}: post or delete its draft handovers first`);
  }
  if (openDispatches > 0) {
    throw new Error(`Cannot ${action}: send, cancel or delete its open surat jalan first`);
  }
}

async function requireOrder(id: string): Promise<LeanOrder> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid SPK id");
  const order = (await ProductionOrderRepo.model.findById(id).lean().exec()) as LeanOrder | null;
  if (!order) throw new Error("SPK not found");
  return order;
}

function makeTypeOf(item: LeanItem): ShopDrawingMakeType {
  return item.makeType ?? "inhouse";
}

/** RAB labour lines costed to the item: a subcon / outsource item's vendor fee. */
async function itemFeeLines(
  projectId: string,
  itemId: string,
): Promise<Array<{ materialItemId: string; itemUomId: string; totalQty: string }>> {
  const rab = await ProjectRabRepo.model
    .findOne({ projectId: new Types.ObjectId(projectId) })
    .select({ lines: 1 })
    .lean()
    .exec();
  return (rab?.lines ?? [])
    .filter(
      (l) =>
        isLabourLine(l) &&
        l.shopDrawingItemId !== undefined &&
        String(l.shopDrawingItemId) === itemId,
    )
    .map((l) => ({
      materialItemId: String(l.materialItemId),
      itemUomId: String(l.itemUomId),
      totalQty: l.totalQty,
    }));
}

/**
 * What an SPK of `qty` needs: BOQ materials (rounded like the RAB, after the
 * item's other SPKs) plus, for subcon / outsource, the vendor fee lines.
 */
async function planOrderMaterials(
  type: ProductionOrderInterface["type"],
  state: ItemState,
  qty: string,
  siblings: LeanOrder[],
  exceptId: string,
): Promise<PlannedMaterial[]> {
  if (!state.boq) return [];
  const projectId = String(state.boq.projectId);
  const itemId = String(state.item._id);
  const materials = planMaterials(
    state.boq,
    qty,
    await materialOptions(state.boq, siblings, exceptId),
  );
  if (!hasVendorFee(type)) return materials;
  return [
    ...materials,
    ...planFeeLines(await itemFeeLines(projectId, itemId), state.boq.makeQty, qty),
  ];
}

/** POs with lines on the SPK, newest first, with this SPK's share of the total. */
async function purchaseOrdersFor(orderId: Types.ObjectId): Promise<ProductionOrderPurchaseOutDto[]> {
  const pos = await PurchaseOrderRepo.model
    .find({ "lines.productionOrderId": orderId })
    .select({ number: 1, vendorId: 1, status: 1, lines: 1 })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  if (pos.length === 0) return [];
  const vendors = await VendorRepo.model
    .find({ _id: { $in: pos.map((p) => p.vendorId) } })
    .select({ name: 1 })
    .lean()
    .exec();
  const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
  const ownLines = (po: (typeof pos)[number]) =>
    po.lines.filter((l) => l.productionOrderId && String(l.productionOrderId) === String(orderId));
  const labour = await labourItemIds(
    pos.flatMap((po) => ownLines(po).map((l) => String(l.materialItemId))),
  );
  return pos.map((po) => ({
    id: String(po._id),
    number: po.number,
    vendorName: vendorName.get(String(po.vendorId)) ?? "Unknown vendor",
    status: po.status,
    total: formatDecimal(
      ownLines(po)
        .reduce((sum, l) => sum.plus(new Decimal(l.qty).times(l.unitPrice)), new Decimal(0))
        .round(),
    ),
    vendorFee: ownLines(po).some((l) => labour.has(String(l.materialItemId))),
  }));
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
        exactQty: r.exactQty,
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
        makeType: makeTypeOf(s.item),
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
        exactQty: m.exactQty ?? m.qty,
        qty: m.qty,
      }));
      const [sd, prod] = await Promise.all([
        ProjectShopDrawingDocumentRepo.model
          .findById(snap.shopDrawingFileId)
          .select({ originalFilename: 1 })
          .lean()
          .exec(),
        snap.productionFileId
          ? ProjectProductionFileRepo.model
              .findById(snap.productionFileId)
              .select({ originalFilename: 1 })
              .lean()
              .exec()
          : null,
      ]);
      sdFile = {
        id: snap.shopDrawingFileId,
        version: snap.shopDrawingFileVersion,
        originalFilename: sd?.originalFilename ?? "(deleted)",
      };
      productionFile = snap.productionFileId
        ? {
            id: snap.productionFileId,
            version: snap.productionFileVersion ?? 0,
            originalFilename: prod?.originalFilename ?? "(deleted)",
          }
        : null;
    } else {
      const state = await itemStateFor(projectId, itemId).catch(() => null);
      makeQty = state?.boq?.makeQty ?? "0";
      // Draft preview: rounded as if released now, after the item's released SPKs.
      planned = state
        ? await planOrderMaterials(
            order.type,
            state,
            order.qty,
            await ordersForItem(projectId, itemId),
            String(order._id),
          )
        : [];
      sdFile = state?.sdFile ?? null;
      productionFile = state?.productionFile ?? null;
    }

    const siblings = await ordersForItem(projectId, itemId);
    const progress = await progressByOrder(siblings);
    const done = new Map([...progress].map(([k, v]) => [k, v.doneQty]));
    const max = maxOrderQty(makeQty, qtyRows(siblings), done, String(order._id));
    const stages = order.snapshot?.labourStages ?? [];
    const thisProgress = progress.get(String(order._id));
    const byStage = thisProgress?.byStage ?? new Map<number, string>();
    const labourStagesOut: ProductionLabourStageOutDto[] = [...stages]
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => ({
        sequence: s.sequence,
        name: s.name,
        weightPercent: s.weightPercent,
        materialItemId: String(s.materialItemId),
        itemUomId: String(s.itemUomId),
        qtyDone: byStage.get(s.sequence) ?? "0",
      }));

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
      purchaseOrders: await purchaseOrdersFor(order._id),
      handovers: hasVendorFee(order.type) ? await handoversOut(order._id) : [],
      defaultHandoverChecklist: [...DEFAULT_HANDOVER_CHECKLIST],
      vendorFees: await vendorFeesOut(order),
      ...(await subconDispatchOut(order)),
      labourStages: labourStagesOut,
      reports: reports.map((r): ProductionReportOutDto => ({
        id: String(r._id),
        productionOrderId: String(r.productionOrderId),
        handoverId: r.handoverId ? String(r.handoverId) : null,
        qtyDone: r.qtyDone,
        stageSequence:
          typeof r.stageSequence === "number" ? r.stageSequence : null,
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
    const type = makeTypeOf(state.item);

    const created = await withTx(async () => {
      const siblings = await ordersForItem(input.projectId, input.shopDrawingItemId);
      const done = await doneByOrder(siblings.map((o) => o._id));
      assertOrderQty(input.qty, maxOrderQty(state.boq!.makeQty, qtyRows(siblings), done));
      return ProductionOrderRepo.create({
        projectId: new Types.ObjectId(input.projectId),
        shopDrawingItemId: new Types.ObjectId(input.shopDrawingItemId),
        number: await allocateOrderNumber(),
        type,
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
    if (!EDITABLE_STATUSES.includes(order.status)) {
      throw new Error("A completed or cancelled SPK cannot be edited");
    }
    const isDraft = order.status === "draft";
    const start = input.plannedStart !== undefined ? input.plannedStart : order.plannedStart ?? null;
    const finish = input.plannedFinish !== undefined ? input.plannedFinish : order.plannedFinish ?? null;
    if (start && finish && finish < start) {
      throw new Error("plannedFinish cannot be before plannedStart");
    }
    if (!isDraft) {
      const picUserId = input.picUserId !== undefined ? input.picUserId : order.picUserId;
      if (!picUserId) throw new Error("A released SPK needs a PIC");
      if (!start || !finish) {
        throw new Error("A released SPK needs a planned start and finish");
      }
    }
    const qtyChanged = input.qty !== undefined && !new Decimal(input.qty).eq(order.qty);
    if (qtyChanged && !isDraft) await assertNoOrderActivity(order, "change the qty");
    let snapshot: ProductionOrderSnapshot | undefined;
    if (qtyChanged) {
      const projectId = String(order.projectId);
      const itemId = String(order.shopDrawingItemId);
      const state = await itemStateFor(projectId, itemId);
      if (!state.boq) throw new Error("This item has no BOQ");
      const siblings = await ordersForItem(projectId, itemId);
      const done = await doneByOrder(siblings.map((o) => o._id));
      assertOrderQty(
        input.qty!,
        maxOrderQty(state.boq.makeQty, qtyRows(siblings), done, id),
      );
      if (order.snapshot) {
        // A released SPK keeps its frozen per-unit materials; totals follow the qty, rounded again.
        // Vendor fee lines are re-spread from the RAB so a full-qty SPK gets the exact fee qty.
        const fee = hasVendorFee(order.type) ? await itemFeeLines(projectId, itemId) : [];
        const feeKeys = new Set(fee.map((l) => rabLineKey(l.materialItemId, l.itemUomId)));
        const rows =
          order.type === "outsource"
            ? await planOrderMaterials(order.type, state, input.qty!, siblings, id)
            : [
                ...scaleMaterials(
                  order.snapshot.materials
                    .map((m) => ({
                      materialItemId: String(m.materialItemId),
                      itemUomId: String(m.itemUomId),
                      qtyPerUnit: m.qtyPerUnit,
                    }))
                    .filter((m) => !feeKeys.has(rabLineKey(m.materialItemId, m.itemUomId))),
                  input.qty!,
                  await materialOptions(state.boq, siblings, id),
                ),
                ...planFeeLines(fee, state.boq.makeQty, input.qty!),
              ];
        snapshot = {
          ...order.snapshot,
          materials: rows.map((m) => ({
            materialItemId: new Types.ObjectId(m.materialItemId),
            itemUomId: new Types.ObjectId(m.itemUomId),
            qtyPerUnit: m.qtyPerUnit,
            exactQty: m.exactQty,
            qty: m.qty,
          })),
        };
      }
    }
    const updated = await ProductionOrderRepo.findOneAndUpdate(
      { _id: order._id, status: order.status },
      {
        $set: {
          ...(qtyChanged ? { qty: input.qty } : {}),
          ...(snapshot ? { snapshot } : {}),
          ...(input.plannedStart !== undefined ? { plannedStart: input.plannedStart } : {}),
          ...(input.plannedFinish !== undefined ? { plannedFinish: input.plannedFinish } : {}),
          ...(input.picUserId !== undefined
            ? await picFields(input.picUserId)
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
      },
    );
    if (!updated) throw new Error("SPK changed meanwhile; reload and try again");
    return this.getOrder(id);
  }

  /** Undo a release that nothing has acted on yet: back to an editable draft. */
  async revertOrder(id: string): Promise<ProductionOrderOutDto> {
    const order = await requireOrder(id);
    if (order.status !== "released") {
      throw new Error("Only a released SPK with no output can go back to draft");
    }
    await assertNoOrderActivity(order, "revert to draft");
    const updated = await ProductionOrderRepo.findOneAndUpdate(
      { _id: order._id, status: "released" },
      {
        $set: {
          status: "draft",
          releasedAt: null,
          releasedBy: null,
          releasedByName: "",
          snapshot: null,
        },
      },
    );
    if (!updated) throw new Error("Failed to revert SPK");
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
    const unset = [
      !order.picUserId && "PIC",
      !order.plannedStart && "planned start",
      !order.plannedFinish && "planned finish",
    ].filter(Boolean);
    if (unset.length > 0) {
      throw new Error(`Cannot release: set the ${unset.join(", ")} first`);
    }
    const projectId = String(order.projectId);
    const itemId = String(order.shopDrawingItemId);
    const state = await itemStateFor(projectId, itemId);
    const missing = [
      !state.sdFile && "shop drawing file",
      !state.boq && "BOQ",
      !state.productionFile && needsProductionFile(order.type) && "File Produksi",
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(`Cannot release: this item has no ${missing.join(", ")}`);
    }
    const boq = state.boq!;
    const siblings = await ordersForItem(projectId, itemId);
    const done = await doneByOrder(siblings.map((o) => o._id));
    assertOrderQty(order.qty, maxOrderQty(boq.makeQty, qtyRows(siblings), done, id));

    if (hasVendorFee(order.type) && (await itemFeeLines(projectId, itemId)).length === 0) {
      throw new Error(
        "Cannot release: add the vendor fee as a RAB labour line on this item first",
      );
    }
    const labourStages =
      order.type === "inhouse"
        ? await itemLabourStagesForRelease(projectId, itemId)
        : [];
    const materials = await planOrderMaterials(order.type, state, order.qty, siblings, id);
    const snapshot: ProductionOrderSnapshot = {
      makeQty: boq.makeQty,
      boqId: boq._id,
      shopDrawingFileId: state.sdFile!.id,
      shopDrawingFileVersion: state.sdFile!.version,
      productionFileId: state.productionFile?.id ?? null,
      productionFileVersion: state.productionFile?.version ?? null,
      materials: materials.map((m) => ({
        materialItemId: new Types.ObjectId(m.materialItemId),
        itemUomId: new Types.ObjectId(m.itemUomId),
        qtyPerUnit: m.qtyPerUnit,
        exactQty: m.exactQty,
        qty: m.qty,
      })),
      ...(labourStages.length > 0 ? { labourStages } : {}),
    };
    const updated = await ProductionOrderRepo.findOneAndUpdate(
      { _id: order._id, status: "draft" },
      {
        $set: {
          status: "released",
          releasedAt: new Date(),
          releasedBy: new Types.ObjectId(userId),
          releasedByName: await userDisplayName(userId),
          snapshot,
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
    await assertNoDraftHandovers(order, "complete this SPK");
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
    await assertNoDraftHandovers(order, "cancel this SPK");
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
    if (hasVendorFee(order.type)) {
      throw new Error("A vendor's output is recorded with a handover, not a report");
    }
    if (input.reportDate > jakartaYmdString()) {
      throw new Error("reportDate cannot be in the future");
    }
    const stages = order.snapshot?.labourStages ?? [];
    if (stages.length > 0) {
      if (input.stageSequence == null) {
        throw new Error("Pick which labour stage this report finishes");
      }
    } else if (input.stageSequence != null) {
      throw new Error("This SPK has no labour stages; omit stageSequence");
    }
    await withTx(async () => {
      if (stages.length > 0) {
        const live = (await ProductionReportRepo.model
          .find({ productionOrderId: order._id, isVoided: false })
          .select({ qtyDone: 1, stageSequence: 1 })
          .lean()
          .exec()) as Array<{ qtyDone: string; stageSequence?: number | null }>;
        const byStage = qtyByStage(live, stages);
        assertStageReportQty({
          stages,
          qtyByStage: byStage,
          stageSequence: input.stageSequence!,
          qtyDone: input.qtyDone,
          orderQty: order.qty,
        });
      } else {
        const already = (await doneByOrder([order._id])).get(orderId) ?? "0";
        assertReportQty(input.qtyDone, order.qty, already);
      }
      await ProductionReportRepo.create({
        projectId: order.projectId,
        productionOrderId: order._id,
        shopDrawingItemId: order.shopDrawingItemId,
        qtyDone: input.qtyDone,
        ...(input.stageSequence != null
          ? { stageSequence: input.stageSequence }
          : { stageSequence: null }),
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
    if (report.handoverId) throw new Error("This report comes from a handover: void the handover instead");
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
    const [projects, items, progress, picNames] = await Promise.all([
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
      progressByOrder(orders),
      userDisplayNames(picIds),
    ]);
    const projectById = new Map(projects.map((p) => [String(p._id), p]));
    const itemById = new Map(items.map((i) => [String(i._id), i]));
    return orders.map((o) => {
      const project = projectById.get(String(o.projectId));
      const item = itemById.get(String(o.shopDrawingItemId));
      const p = progress.get(String(o._id));
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
        doneQty: p?.doneQty ?? "0",
        progressPercent: p?.progressPercent ?? 0,
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
  const [project, item, specs] = await Promise.all([
    ProjectRepo.model
      .findById(order.projectId)
      .select({ name: 1, projectNumber: 1, customerId: 1 })
      .lean()
      .exec(),
    ProjectShopDrawingItemRepo.model
      .findById(order.shopDrawingItemId)
      .select({ code: 1, name: 1, dimension: 1 })
      .lean()
      .exec(),
    loadShopDrawingSpecs([order.shopDrawingItemId]),
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

  // Subcon / outsource: the SPK goes out to the vendor once its fee PO is approved.
  const outsource = order.type === "outsource";
  const vendorWork = hasVendorFee(order.type);
  const approvedVendors = [
    ...new Set(
      order.purchaseOrders
        .filter((p) => p.vendorFee && p.status === "approved")
        .map((p) => p.vendorName),
    ),
  ];
  const titleSuffix = isDraft
    ? " (DRAFT)"
    : vendorWork && approvedVendors.length === 0
      ? " (MENUNGGU PO DISETUJUI)"
      : "";
  const title = outsource
    ? "SURAT PERINTAH KERJA OUTSOURCE"
    : order.type === "subcon"
      ? "SURAT PERINTAH KERJA SUBKON"
      : "SURAT PERINTAH KERJA PRODUKSI";

  const data: SpkPdfData = {
    companyName,
    letterhead,
    title: `${title}${titleSuffix}`,
    meta: {
      left: [
        ["Proyek", order.projectNumber],
        ["Nama Proyek", order.projectName],
        ["Customer", customer?.name ?? "-"],
        ...(vendorWork
          ? [["Vendor", approvedVendors.join(", ") || "-"] as [string, string]]
          : []),
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
      descriptions: specs.get(order.shopDrawingItemId) ?? [],
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
      ...(outsource && !order.productionFile
        ? []
        : [fileRow("File Produksi", "production", order.productionFile)]),
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
