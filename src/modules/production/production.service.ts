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
  ProductionOrderPurchaseOutDto,
  ProductionPicUserOutDto,
  ProductionProjectProgressOutDto,
  ProductionReadinessOutDto,
  ProductionReportOutDto,
  ProductionStageProgressOutDto,
  UpdateProductionOrderInDto,
} from "../../dto/production.dto";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import {
  ProductionOrderRepo,
  type ProductionOrderInterface,
  type ProductionOrderSnapshot,
  type ProductionOrderStatus,
} from "../../models/productionOrder.model";
import {
  ProductionReportRepo,
  type ProductionReportInterface,
} from "../../models/productionReport.model";
import { ProductionHandoverRepo } from "../../models/productionHandover.model";
import { MaterialDispatchRepo } from "../../models/materialDispatch.model";
import { type ShopDrawingMakeType } from "../../models/projectShopDrawingItem.model";
import { ProductionSeqCounterModel } from "../../models/seqCounter.model";
import { companyLetterhead, loadCompanyLogo } from "../appConfig";
import { env } from "../../core/env";
import {
  formatExportYmd,
  formatLongDate,
  safeFilenamePart,
  splitLines,
  ymdLong,
} from "../../utils/document/text";
import { buildSpkPdf, type SpkPdfData } from "./production.pdf";
import {
  assertAssignableUser,
  getUserDisplayNames,
  getUserRef,
  listAssignableUsers,
  userEmailsById,
} from "../auth";
import { jakartaYmdString } from "../../utils/time";
import { formatDecimal, percentOf } from "../../utils/decimal";
import { labourItemIds, loadItemMeta } from "../itemMaster";
import { numberingPeriod } from "../../utils/numbering";
import {
  getProductionFileNames,
  getProjectRab,
  getProjectRef,
  getProjectRefs,
  getShopDrawingFileNames,
  getShopDrawingItemRef,
  getShopDrawingItemRefs,
  listCurrentItemFiles,
  listLiveShopDrawingItems,
  listShopDrawingBoqs,
  loadRabUomPlan,
  loadShopDrawingSpecs,
  markProjectReleasedToProduction,
  projectRabChangeService,
  type ProjectRefDto,
  rabLineKey,
  type ShopDrawingBoqSnapshot,
  shopDrawingItemLabel,
} from "../project";
import { getWonQuotationRef } from "../quotation";
import {
  carriesMaterials,
  handoversOut,
  hasVendorFee,
  materialsNotArrived,
  vendorFeesOut,
} from "./vendorWork";
import {
  assertOrderReportRoom,
  assertOrderVoidRoom,
  itemLabourLines,
  orderLineKey,
  projectLabourLines,
  roomSourceLabel,
  type LabourLineState,
} from "./stageFlow";
import { subconDispatchOut } from "./materialDispatch.queries";
import { DEFAULT_HANDOVER_CHECKLIST, allocatedQty, assertLabourStages, installCapacity, installedQty, itemInstallPercent, assertOrderQty, evaluateReadiness, itemMakingPercent, madeQty, maxOrderQty, needsBoq, needsProductionFile, planFeeLines, planMaterials, scaleMaterials, processReadiness, progressStatus, stageRoom, type OrderQtyRow, type PlannedMaterial, type PriorMaterialIssue } from "./production.planner";
import { getVendorNames } from "../vendor";
import { countLivePurchasesForSpks, listSpkPurchaseOrders } from "../purchasing";
import { getCustomerRef } from "../customer";

/** Release refused: carries the readiness so the client can show what is missing. */
export class ProductionNotReadyError extends Error {
  constructor(readonly readiness: ProductionReadinessOutDto) {
    super("Project is not ready for production");
  }
}

type LeanOrder = ProductionOrderInterface & { _id: Types.ObjectId };
type LeanReport = ProductionReportInterface & { _id: Types.ObjectId };
type LeanBoq = ShopDrawingBoqSnapshot;
type LeanProject = ProjectRefDto;
type LeanItem = {
  _id: Types.ObjectId;
  code?: string;
  name: string;
  category?: string | null;
  makeType?: ShopDrawingMakeType;
  makeQty?: string | null;
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

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function fileRefOut(f: FileRef | null): ProductionOrderFileRefOutDto | null {
  return f
    ? { fileId: String(f.id), version: f.version, originalFilename: f.originalFilename }
    : null;
}

async function allocateOrderNumber(): Promise<string> {
  const parts = numberingPeriod();
  const counter = await ProductionSeqCounterModel.findOneAndUpdate(
    { scopeKey: `spk:${parts.scopeKey}` },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey: `spk:${parts.scopeKey}` } },
    { upsert: true, returnDocument: "after" },
  ).exec();
  if (!counter || counter.nextSeq < 1) {
    throw new Error("Failed to allocate SPK number");
  }
  return `SPK/${parts.roman}/${parts.year}/${String(counter.nextSeq).padStart(4, "0")}`;
}

/** Display name for a user: full name, else email. */
async function userDisplayName(userId: string): Promise<string> {
  const user = await getUserRef(userId);
  if (!user) throw new Error("User not found");
  return user.name;
}

/** id → full name (email when no full name) for existing users. */
async function userDisplayNames(ids: string[]): Promise<Map<string, string>> {
  return getUserDisplayNames(ids);
}

/** PIC fields for a user id (null clears the PIC). */
async function picFields(
  picUserId: string | null,
): Promise<{ picUserId: Types.ObjectId | null; pic: string }> {
  if (!picUserId) return { picUserId: null, pic: "" };
  const user = await assertAssignableUser(picUserId, "PIC user");
  return { picUserId: new Types.ObjectId(picUserId), pic: user.name };
}

async function requireProject(projectId: string): Promise<LeanProject> {
  if (!Types.ObjectId.isValid(projectId)) throw new Error("Invalid project id");
  const project = await getProjectRef(projectId);
  if (!project) throw new Error("Project not found");
  return project;
}

async function loadItemStates(projectId: string): Promise<ItemState[]> {
  const [items, files] = await Promise.all([
    listLiveShopDrawingItems(projectId).then((rows) =>
      rows.map(
        (i): LeanItem => ({
          _id: new Types.ObjectId(i.id),
          code: i.code,
          name: i.name,
          category: i.category,
          ...(i.makeType ? { makeType: i.makeType } : {}),
          makeQty: i.makeQty,
        }),
      ),
    ),
    listCurrentItemFiles(projectId),
  ]);
  const boqs = await listShopDrawingBoqs(projectId, {
    shopDrawingFileIds: files.shopDrawing.map((f) => f.id),
  });

  const sdByItem = new Map(files.shopDrawing.map((f) => [f.itemId, f]));
  const prodByItem = new Map(files.production.map((f) => [f.itemId, f]));
  const boqByFile = new Map(boqs.map((b) => [String(b.shopDrawingFileId), b]));

  return items.map((item) => {
    const sd = sdByItem.get(String(item._id)) ?? null;
    const prod = prodByItem.get(String(item._id)) ?? null;
    return {
      item,
      sdFile: sd
        ? { id: new Types.ObjectId(sd.id), version: sd.version, originalFilename: sd.originalFilename }
        : null,
      boq: sd ? (boqByFile.get(sd.id) ?? null) : null,
      productionFile: prod
        ? { id: new Types.ObjectId(prod.id), version: prod.version, originalFilename: prod.originalFilename }
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

type OrderProgress = { doneQty: string; progressPercent: number };

/** Finished pcs + % per SPK: Σ live reports over the SPK qty. */
async function progressByOrder(
  orders: Array<{ _id: Types.ObjectId; qty: string }>,
): Promise<Map<string, OrderProgress>> {
  const out = new Map<string, OrderProgress>();
  if (orders.length === 0) return out;
  const rows = await ProductionReportRepo.model
    .find({ productionOrderId: { $in: orders.map((o) => o._id) }, isVoided: false })
    .select({ productionOrderId: 1, qtyDone: 1 })
    .lean()
    .exec();
  const sums = new Map<string, Decimal>();
  for (const r of rows) {
    const key = String(r.productionOrderId);
    sums.set(key, (sums.get(key) ?? new Decimal(0)).plus(r.qtyDone));
  }
  for (const o of orders) {
    const doneQty = formatDecimal(sums.get(String(o._id)) ?? new Decimal(0));
    out.set(String(o._id), { doneQty, progressPercent: percentOf(doneQty, o.qty) });
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
    .select({ qty: 1 })
    .lean()
    .exec()) as Array<{ _id: Types.ObjectId; qty: string }>;
  const progress = await progressByOrder(orders);
  return new Map([...progress].map(([k, v]) => [k, v.doneQty]));
}

/** The SPK's RAB labour line, or an error when it is gone from the RAB. */
function requireLine(lines: LabourLineState[], key: string): LabourLineState {
  const line = lines.find((l) => l.key === key);
  if (!line) throw new Error("This labour line is no longer on the item's RAB");
  return line;
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

/** The item's SPKs on one labour line. */
function onLine(orders: LeanOrder[], key: string): LeanOrder[] {
  return orders.filter((o) => orderLineKey(o) === key);
}

/** Line key → Σ done over the given SPKs. */
function doneByLineFrom(orders: LeanOrder[], done: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const o of orders) {
    const key = orderLineKey(o);
    out.set(
      key,
      formatDecimal(new Decimal(out.get(key) ?? "0").plus(done.get(String(o._id)) ?? "0")),
    );
  }
  return out;
}

/** What a line's SPKs may hold in all: makeQty for a making stage, pcs fully made for install. */
function lineCapacity(
  line: LabourLineState,
  lines: LabourLineState[],
  makeQty: string,
  siblings: LeanOrder[],
  done: Map<string, string>,
): string {
  return line.role === "install"
    ? installCapacity(lines, doneByLineFrom(siblings, done), line.key)
    : makeQty;
}

/** A vendor SPK's fee: its own RAB labour line. */
function feeLine(line: LabourLineState) {
  return { materialItemId: line.labourItemId, itemUomId: line.labourUomId, totalQty: line.totalQty };
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
  const [reports, handovers, livePurchases] = await Promise.all([
    ProductionReportRepo.model.countDocuments({ productionOrderId: order._id }).exec(),
    ProductionHandoverRepo.model.countDocuments({ productionOrderId: order._id }).exec(),
    countLivePurchasesForSpks([String(order._id)]),
  ]);
  if (reports > 0) {
    throw new Error(`Cannot ${action}: this SPK has production reports`);
  }
  if (handovers > 0) {
    throw new Error(`Cannot ${action}: this SPK has vendor handovers`);
  }
  if (livePurchases > 0) {
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

/** Pcs to make: the BOQ's, or on an outsource item (no BOQ) its own qty. */
function itemMakeQty(state: ItemState): string | null {
  if (makeTypeOf(state.item) === "outsource" && state.item.makeQty) return state.item.makeQty;
  return state.boq?.makeQty ?? null;
}

function requireMakeQty(state: ItemState): string {
  const qty = itemMakeQty(state);
  if (!qty) {
    throw new Error(
      makeTypeOf(state.item) === "outsource"
        ? "Set this outsource item's qty first"
        : "This item has no BOQ",
    );
  }
  return qty;
}

/**
 * What an SPK of `qty` needs: the BOQ materials on first-stage SPKs (rounded
 * like the RAB, after the line's other SPKs) plus, on vendor SPKs, its own
 * labour line as the fee.
 */
async function planOrderMaterials(
  order: Pick<ProductionOrderInterface, "executor" | "role" | "sequence">,
  state: ItemState,
  line: LabourLineState,
  qty: string,
  siblings: LeanOrder[],
  exceptId: string,
): Promise<PlannedMaterial[]> {
  const makeQty = itemMakeQty(state);
  if (!makeQty) return [];
  const materials =
    state.boq && carriesMaterials(order)
      ? planMaterials(state.boq, qty, await materialOptions(state.boq, siblings, exceptId))
      : [];
  if (!hasVendorFee(order)) return materials;
  return [...materials, ...planFeeLines([feeLine(line)], makeQty, qty)];
}

/** POs with lines on the SPK, newest first, with this SPK's share of the total. */
async function purchaseOrdersFor(orderId: Types.ObjectId): Promise<ProductionOrderPurchaseOutDto[]> {
  const pos = await listSpkPurchaseOrders(String(orderId), { sort: "newest" });
  if (pos.length === 0) return [];
  const vendorName = await getVendorNames(pos.map((p) => p.vendorId));
  const labour = await labourItemIds(pos.flatMap((po) => po.lines.map((l) => l.materialItemId)));
  return pos.map((po) => ({
    id: po.id,
    number: po.number,
    vendorName: vendorName.get(po.vendorId) ?? "Unknown vendor",
    status: po.status,
    total: formatDecimal(
      po.lines
        .reduce((sum, l) => sum.plus(new Decimal(l.qty).times(l.unitPrice)), new Decimal(0))
        .round(),
    ),
    vendorFee: po.lines.some((l) => labour.has(l.materialItemId)),
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
    const [won, rab, change, states, labourByItem] = await Promise.all([
      getWonQuotationRef(projectId),
      getProjectRab(projectId),
      projectRabChangeService.findOpenDraft(projectId),
      loadItemStates(projectId),
      projectLabourLines(projectId),
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
        makeQty: itemMakeQty(s),
        hasProductionFile: s.productionFile !== null,
        labour: labourByItem.get(String(s.item._id)) ?? [],
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
    await markProjectReleasedToProduction(projectId, userId);
    return this.readiness(projectId);
  }

  async progress(projectId: string): Promise<ProductionProjectProgressOutDto> {
    const project = await requireProject(projectId);
    const [states, orders, labourByItem] = await Promise.all([
      loadItemStates(projectId),
      ProductionOrderRepo.model
        .find({ projectId: new Types.ObjectId(projectId) })
        .lean()
        .exec() as Promise<LeanOrder[]>,
      projectLabourLines(projectId),
    ]);
    const done = await doneByOrder(orders.map((o) => o._id));

    let totalMake = new Decimal(0);
    let totalDone = new Decimal(0);
    let totalWeighted = new Decimal(0);
    const items = states.map((s): ProductionItemProgressOutDto => {
      const itemId = String(s.item._id);
      const itemOrders = orders.filter((o) => String(o.shopDrawingItemId) === itemId);
      // Released SPKs remember makeQty; fall back to the live BOQ.
      const makeQty =
        itemMakeQty(s) ?? itemOrders.find((o) => o.snapshot)?.snapshot?.makeQty ?? "0";
      const lines = labourByItem.get(itemId) ?? [];
      const doneByLine = doneByLineFrom(itemOrders, done);
      const made = madeQty(lines, doneByLine);
      const stages = lines.map((l): ProductionStageProgressOutDto => {
        const lineOrders = onLine(itemOrders, l.key);
        const capacity = new Decimal(
          l.role === "install" ? installCapacity(lines, doneByLine, l.key) : makeQty,
        );
        const ordered = allocatedQty(qtyRows(lineOrders), done);
        const free = capacity.minus(ordered);
        return {
          key: l.key,
          labourItemId: l.labourItemId,
          labourUomId: l.labourUomId,
          name: l.name,
          role: l.role,
          executor: l.executor,
          sequence: l.sequence,
          weightPercent: l.weightPercent,
          orderedQty: formatDecimal(ordered),
          doneQty: doneByLine.get(l.key) ?? "0",
          remainingToOrder: formatDecimal(free.isNeg() ? new Decimal(0) : free),
          orderCount: lineOrders.filter((o) => o.status !== "cancelled").length,
        };
      });
      const first = stages.find((st) => st.role === "making");
      const orderedQty = first?.orderedQty ?? "0";
      const installed = installedQty(lines, doneByLine);
      const percent = itemMakingPercent(makeQty, lines, doneByLine);
      const installPercent = itemInstallPercent(makeQty, lines, doneByLine);
      const process = processReadiness(lines);
      const status = progressStatus({ makeQty, orderedQty, doneQty: made });
      totalMake = totalMake.plus(makeQty);
      totalDone = totalDone.plus(made);
      totalWeighted = totalWeighted.plus(new Decimal(makeQty).times(percent));
      return {
        itemId,
        code: s.item.code ?? "",
        name: s.item.name,
        label: shopDrawingItemLabel(s.item),
        category: s.item.category ?? null,
        makeType: makeTypeOf(s.item),
        makeQty,
        orderedQty,
        doneQty: made,
        remainingToOrder: first?.remainingToOrder ?? makeQty,
        percent,
        installedQty: installed,
        installPercent,
        processReady: process.ok,
        processDetail: process.detail,
        // Stages under way count as in progress before the first pc is fully made.
        status: percent > 0 && (status === "partial" || status === "not_started") ? "in_progress" : status,
        orderCount: itemOrders.filter((o) => o.status !== "cancelled").length,
        stages,
      };
    });

    return {
      projectId,
      releasedAt: iso(project.productionReleasedAt),
      items,
      totals: {
        makeQty: formatDecimal(totalMake),
        doneQty: formatDecimal(totalDone),
        percent: totalMake.gt(0)
          ? Math.round(totalWeighted.div(totalMake).toNumber())
          : 0,
      },
    };
  }

  /** Active users that can be picked as SPK person in charge. */
  async listPicUsers(): Promise<ProductionPicUserOutDto[]> {
    const users = await listAssignableUsers();
    return users.map((u) => ({ id: u.id, name: u.name, email: u.email }));
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

    const [lines, siblings] = await Promise.all([
      itemLabourLines(projectId, itemId),
      ordersForItem(projectId, itemId),
    ]);
    const key = orderLineKey(order);
    const line = lines.find((l) => l.key === key) ?? null;
    const lineSiblings = onLine(siblings, key);

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
      const [sdNames, prodNames] = await Promise.all([
        getShopDrawingFileNames([snap.shopDrawingFileId]),
        getProductionFileNames([snap.productionFileId]),
      ]);
      sdFile = {
        id: snap.shopDrawingFileId,
        version: snap.shopDrawingFileVersion,
        originalFilename: sdNames.get(String(snap.shopDrawingFileId)) ?? "(deleted)",
      };
      productionFile = snap.productionFileId
        ? {
            id: snap.productionFileId,
            version: snap.productionFileVersion ?? 0,
            originalFilename: prodNames.get(String(snap.productionFileId)) ?? "(deleted)",
          }
        : null;
    } else {
      const state = await itemStateFor(projectId, itemId).catch(() => null);
      makeQty = (state ? itemMakeQty(state) : null) ?? "0";
      // Draft preview: as if released now (the RAB line decides role and stage), rounded after the line's released SPKs.
      planned =
        state && line
          ? await planOrderMaterials(
              { executor: line.executor, role: line.role, sequence: line.sequence },
              state,
              line,
              order.qty,
              lineSiblings,
              String(order._id),
            )
          : [];
      sdFile = state?.sdFile ?? null;
      productionFile = state?.productionFile ?? null;
    }

    const progress = await progressByOrder(siblings);
    const done = new Map([...progress].map(([k, v]) => [k, v.doneQty]));
    const capacity = line ? lineCapacity(line, lines, makeQty, siblings, done) : makeQty;
    const max = maxOrderQty(capacity, qtyRows(lineSiblings), done, String(order._id));
    const room = line ? stageRoom(lines, doneByLineFrom(siblings, done), key) : null;

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
      reportRoom: room ? formatDecimal(room) : null,
      reportRoomFrom: room ? roomSourceLabel(lines, key) : null,
      purchaseOrders: await purchaseOrdersFor(order._id),
      materialsNotArrived: ACTIVE_STATUSES.includes(order.status)
        ? await materialsNotArrived(order)
        : [],
      handovers: hasVendorFee(order) ? await handoversOut(order._id) : [],
      defaultHandoverChecklist: [...DEFAULT_HANDOVER_CHECKLIST],
      vendorFees: await vendorFeesOut(order),
      ...(await subconDispatchOut(order)),
      reports: reports.map((r): ProductionReportOutDto => ({
        id: String(r._id),
        productionOrderId: String(r.productionOrderId),
        handoverId: r.handoverId ? String(r.handoverId) : null,
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
    const makeQty = requireMakeQty(state);
    const lines = await itemLabourLines(input.projectId, input.shopDrawingItemId);
    const key = `${input.shopDrawingItemId}:${input.labourItemId}:${input.labourUomId}`;
    const line = requireLine(lines, key);
    try {
      assertLabourStages(lines);
    } catch (e) {
      throw new Error(`Cannot create SPK: ${e instanceof Error ? e.message : String(e)}`);
    }

    const created = await withTx(async () => {
      const siblings = await ordersForItem(input.projectId, input.shopDrawingItemId);
      const done = await doneByOrder(siblings.map((o) => o._id));
      assertOrderQty(
        input.qty,
        maxOrderQty(
          lineCapacity(line, lines, makeQty, siblings, done),
          qtyRows(onLine(siblings, key)),
          done,
        ),
      );
      return ProductionOrderRepo.create({
        projectId: new Types.ObjectId(input.projectId),
        shopDrawingItemId: new Types.ObjectId(input.shopDrawingItemId),
        number: await allocateOrderNumber(),
        labourItemId: new Types.ObjectId(input.labourItemId),
        labourUomId: new Types.ObjectId(input.labourUomId),
        labourName: line.name,
        role: line.role,
        executor: line.executor,
        sequence: line.sequence,
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
      const makeQty = requireMakeQty(state);
      const lines = await itemLabourLines(projectId, itemId);
      const key = orderLineKey(order);
      const line = requireLine(lines, key);
      const siblings = await ordersForItem(projectId, itemId);
      const lineSiblings = onLine(siblings, key);
      const done = await doneByOrder(siblings.map((o) => o._id));
      assertOrderQty(
        input.qty!,
        maxOrderQty(
          lineCapacity(line, lines, makeQty, siblings, done),
          qtyRows(lineSiblings),
          done,
          id,
        ),
      );
      if (order.snapshot) {
        // A released SPK keeps its frozen per-unit materials; totals follow the qty, rounded again.
        // Its vendor fee is re-spread from the RAB line so a full-qty SPK gets the exact fee qty.
        const fee = feeLine(line);
        const feeKey = rabLineKey(fee.materialItemId, fee.itemUomId);
        const rows = [
          ...scaleMaterials(
            order.snapshot.materials
              .map((m) => ({
                materialItemId: String(m.materialItemId),
                itemUomId: String(m.itemUomId),
                qtyPerUnit: m.qtyPerUnit,
              }))
              .filter((m) => rabLineKey(m.materialItemId, m.itemUomId) !== feeKey),
            input.qty!,
            state.boq ? await materialOptions(state.boq, lineSiblings, id) : {},
          ),
          ...(hasVendorFee(order) ? planFeeLines([fee], makeQty, input.qty!) : []),
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
      !state.boq && needsBoq(makeTypeOf(state.item)) && "BOQ",
      !itemMakeQty(state) && !needsBoq(makeTypeOf(state.item)) && "qty",
      !state.productionFile && needsProductionFile(makeTypeOf(state.item)) && "File Produksi",
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(`Cannot release: this item has no ${missing.join(", ")}`);
    }
    const lines = await itemLabourLines(projectId, itemId);
    try {
      assertLabourStages(lines);
    } catch (e) {
      throw new Error(`Cannot release: ${e instanceof Error ? e.message : String(e)}`);
    }
    const key = orderLineKey(order);
    const line = requireLine(lines, key);
    const makeQty = requireMakeQty(state);
    const siblings = await ordersForItem(projectId, itemId);
    const lineSiblings = onLine(siblings, key);
    const done = await doneByOrder(siblings.map((o) => o._id));
    assertOrderQty(
      order.qty,
      maxOrderQty(lineCapacity(line, lines, makeQty, siblings, done), qtyRows(lineSiblings), done, id),
    );

    // The RAB line decides role, done-by and stage order at release.
    const live = { role: line.role, executor: line.executor, sequence: line.sequence };
    const materials = await planOrderMaterials(live, state, line, order.qty, lineSiblings, id);
    const snapshot: ProductionOrderSnapshot = {
      makeQty,
      boqId: state.boq?._id ?? null,
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
      weightPercent: line.weightPercent,
    };
    const updated = await ProductionOrderRepo.findOneAndUpdate(
      { _id: order._id, status: "draft" },
      {
        $set: {
          ...live,
          labourName: line.name,
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
    const notArrived = await materialsNotArrived(order);
    if (notArrived.length > 0 && !note.trim()) {
      throw new Error(
        `Material not fully received (${notArrived.join(", ")}): add a note saying what was used instead`,
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
    if (hasVendorFee(order)) {
      throw new Error("A vendor's output is recorded with a handover, not a report");
    }
    if (input.reportDate > jakartaYmdString()) {
      throw new Error("reportDate cannot be in the future");
    }
    await withTx(async () => {
      const already = (await doneByOrder([order._id])).get(orderId) ?? "0";
      await assertOrderReportRoom(order, input.qtyDone, already);
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
    if (report.handoverId) throw new Error("This report comes from a handover: void the handover instead");
    const order = await requireOrder(String(report.productionOrderId));
    if (!ACTIVE_STATUSES.includes(order.status)) {
      throw new Error("Reports on a completed or cancelled SPK cannot be voided");
    }
    await assertOrderVoidRoom(order, report.qtyDone);
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
    const [projectById, itemById, progress, picNames] = await Promise.all([
      getProjectRefs(projectIds),
      getShopDrawingItemRefs(itemIds),
      progressByOrder(orders),
      userDisplayNames(picIds),
    ]);
    return orders.map((o) => {
      const project = projectById.get(String(o.projectId));
      const item = itemById.get(String(o.shopDrawingItemId));
      const p = progress.get(String(o._id));
      return {
        id: String(o._id),
        number: o.number,
        labourItemId: String(o.labourItemId),
        labourUomId: String(o.labourUomId),
        // SPKs from before the per-labour design have no labour line.
        labourName: o.labourName ?? "",
        role: o.role ?? "making",
        executor: o.executor ?? "inhouse",
        sequence: o.sequence ?? null,
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

/** SPK as a printable PDF; drafts print as DRAFT with no issuer signature. */
/** A qty short enough to print: 3 decimals, or 3 significant digits below 1. */
function printQty(qty: string): string {
  const d = new Decimal(qty || "0");
  return (d.abs().lt(1) ? d.toSignificantDigits(3) : d.toDecimalPlaces(3)).toFixed();
}

export async function exportProductionOrderPdf(
  id: string,
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const order = await productionService.getOrder(id);
  const [project, item, specs] = await Promise.all([
    getProjectRef(order.projectId),
    getShopDrawingItemRef(order.shopDrawingItemId),
    loadShopDrawingSpecs([order.shopDrawingItemId]),
  ]);
  const customer = project ? await getCustomerRef(project.customerId) : null;

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

  // Vendor SPK: it goes out to the vendor once its fee PO is approved.
  const vendorWork = hasVendorFee(order);
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
  const title = vendorWork
    ? "SURAT PERINTAH KERJA VENDOR"
    : order.role === "install"
      ? "SURAT PERINTAH KERJA INSTALASI"
      : "SURAT PERINTAH KERJA PRODUKSI";
  const stage =
    order.role === "install" ? "Instalasi" : order.sequence ? `Tahap ${order.sequence}` : "-";

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
        ["Pekerjaan", `${order.labourName || "-"} (${stage})`],
        ["Dikerjakan", vendorWork ? "Vendor" : "Inhouse"],
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
      ...(order.productionFile
        ? [fileRow("File Produksi", "production", order.productionFile)]
        : []),
    ],
    materials: order.materials.map((m) => ({
      code: m.materialCode,
      name: m.materialName,
      perUnit: printQty(m.qtyPerUnit),
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
