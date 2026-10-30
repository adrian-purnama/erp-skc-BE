import Decimal from "decimal.js";
import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import type {
  OpenRequestLineOutDto,
  PurchaseChargeAmountsDto,
  PurchaseOrderLineOutDto,
  RealizationChargeInDto,
  PurchaseOrderOutDto,
  PurchaseOrderRabCompareLineOutDto,
  PurchaseOrderRabCompareOutDto,
  PurchaseOrderStatusDto,
  PurchaseOrderSummaryOutDto,
  PurchasingOptionOutDto,
  SavePurchaseOrderInDto,
  SavePurchaseOrdersInDto,
  SavePurchaseOrdersOutDto,
  VendorPriceOutDto,
} from "../../dto/purchasing.dto";
import { getUserPermissions } from "../../core/permissions/resolve.service";
import { RoleModel } from "../../models/role.model";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import { ProductionOrderRepo } from "../../models/productionOrder.model";
import { ProjectRepo } from "../../models/project.model";
import { ProjectRabRepo } from "../../models/projectRab.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem.model";
import { PurchaseRabRepo } from "../../models/purchaseRab.model";
import {
  PURCHASE_ORDER_HOLDING_QUERY,
  PurchaseOrderRepo,
  heldLineQty,
  type PurchaseOrderApprovalLevel,
  type PurchaseOrderInterface,
  type PurchaseOrderStatus,
} from "../../models/purchaseOrder.model";
import {
  PurchaseRequestRepo,
  type PurchaseRequestInterface,
  type PurchaseRequestLine,
} from "../../models/purchaseRequest.model";
import { PurchasingSeqCounterModel } from "../../models/seqCounter.model";
import { TermOfPaymentRepo } from "../../models/termOfPayment.model";
import { UserModel } from "../../models/user.model";
import { VendorRepo } from "../../models/vendor.model";
import { userEmailsById } from "../../utils/shared";
import { loadItemMeta } from "../itemMaster/itemMeta";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { projectNumberParts } from "../project/projectNumber";
import { rabLineKey, rabRowsForPurchasing } from "../project/projectRab.planner";
import { shopDrawingItemLabel } from "../project/projectShared";
import {
  checkOrderLines,
  lineAmount,
  remainingToOrder,
  sumOrdered,
  type RequestLineRef,
} from "./purchaseOrder.planner";
import { liveOrderLines } from "./purchaseOrderLines";
import { PurchaseRealizationRepo } from "../../models/purchaseRealization.model";
import {
  chargesByCategory,
  checkRealizationCharges,
  priceStoredCharges,
  realizationStatus,
  sumRealized,
  type ChargeCategory,
} from "./purchaseRealization.planner";
import type { PurchaseCharge } from "../../models/purchaseCharge.model";
import QRCode from "qrcode";
import { env } from "../../core/env";
import { buildPoPdf, type PoPdfData } from "./purchaseOrder.pdf";
import {
  companyLetterhead,
  loadCompanyLogo,
  ymdLong,
} from "../production/production.service";
import { formatExportYmd, safeFilenamePart } from "../project/projectRabExport.planner";
import { formatLongDate, splitLines } from "../quotation/quotation.document";
import { notifyPurchaseOrderEvent } from "./purchasingNotify";
import { PurchasePaymentRepo } from "../../models/purchasePayment.model";
import {
  PURCHASING_BUCKET,
  deleteQuotation,
  listQuotations,
  openQuotation as openQuotationVersion,
  purgeQuotations,
  renameQuotation,
  setCurrentQuotation,
  uploadQuotation as uploadQuotationVersion,
} from "./purchaseOrderQuotation.service";

type LeanOrder = PurchaseOrderInterface & { _id: Types.ObjectId };
type LeanRequest = PurchaseRequestInterface & { _id: Types.ObjectId };
type RequestEntry = { request: LeanRequest; line: PurchaseRequestLine & { _id: Types.ObjectId } };
type LineBase = Omit<OpenRequestLineOutDto, "orderedQty" | "remainingQty">;

/** Who is acting on a PO: only its creator (or super admin) may change it. */
export type PoActor = { userId: string; superAdmin: boolean };

/** Stored estimate rows; the short-lived per-category amounts read as fixed rows. */
function storedEstimates(doc: LeanOrder): PurchaseCharge[] {
  if ((doc.estimatedCharges ?? []).length > 0) return doc.estimatedCharges!;
  const legacy = doc.estimates;
  if (!legacy) return [];
  return (
    [
      ["tax", "Pajak", legacy.tax],
      ["delivery", "Pengiriman", legacy.delivery],
      ["other", "Lainnya", legacy.other],
    ] as const
  ).flatMap(([category, label, amount]) =>
    amount ? [{ category, label, kind: "fixed" as const, rate: null, amount }] : [],
  );
}

/** Estimate rows priced on the current goods total, per category and in total. */
export function estimatesOf(doc: LeanOrder) {
  const priced = priceStoredCharges(doc.total, storedEstimates(doc));
  const has = (c: ChargeCategory) => priced.charges.some((x) => x.category === c);
  const amounts: PurchaseChargeAmountsDto = {
    tax: has("tax") ? priced.byCategory.tax : null,
    delivery: has("delivery") ? priced.byCategory.delivery : null,
    other: has("other") ? priced.byCategory.other : null,
  };
  return { charges: priced.charges, amounts, total: priced.total };
}

function estimatesOut(doc: LeanOrder): PurchaseChargeAmountsDto {
  return estimatesOf(doc).amounts;
}

function isOwner(doc: LeanOrder, actor: PoActor): boolean {
  return actor.superAdmin || String(doc.createdBy) === actor.userId;
}

function assertOwner(doc: LeanOrder, actor: PoActor): void {
  if (!isOwner(doc, actor)) {
    throw new Error("Only the person who created this PO can change it");
  }
}

export { PURCHASING_BUCKET };

/** Permission each approval level needs. */
export const APPROVE_PERM: Record<PurchaseOrderApprovalLevel, string> = {
  1: "purchasing.approve",
  2: "purchasing.approve2",
};

/** Active users whose roles grant `key` (or everything). */
export async function usersWithPermission(key: string) {
  const roles = await RoleModel.find({ effectivePermissions: { $in: [key, "*"] } })
    .select({ key: 1 })
    .lean()
    .exec();
  if (roles.length === 0) return [];
  return UserModel.find({ roles: { $in: roles.map((r) => r.key) }, isBlocked: { $ne: true } })
    .select({ fullName: 1, email: 1 })
    .sort({ fullName: 1, email: 1 })
    .lean()
    .exec();
}

export async function userHasPermission(userId: string, key: string): Promise<boolean> {
  const user = await UserModel.findById(userId).select({ roles: 1, isBlocked: 1 }).lean().exec();
  if (!user || user.isBlocked) return false;
  const perms = await getUserPermissions({ id: String(user._id), roles: user.roles ?? [] });
  return perms.has(key) || perms.has("*");
}

/** Two different people, neither the PO creator, each allowed to approve their level. */
async function assertApprovers(approver1Id: string, approver2Id: string, creatorId: string): Promise<void> {
  if (approver1Id === approver2Id) {
    throw new Error("Level 1 and level 2 approver must be different people");
  }
  if (approver1Id === creatorId || approver2Id === creatorId) {
    throw new Error("The person who made the PO cannot approve it");
  }
  const [ok1, ok2] = await Promise.all([
    userHasPermission(approver1Id, APPROVE_PERM[1]),
    userHasPermission(approver2Id, APPROVE_PERM[2]),
  ]);
  if (!ok1) throw new Error("The level 1 approver cannot approve level 1 (missing permission or blocked)");
  if (!ok2) throw new Error("The level 2 approver cannot approve level 2 (missing permission or blocked)");
}

/** The approver a pending PO waits on now, or null. */
function currentApprover(doc: LeanOrder): string | null {
  if (doc.status !== "pending_approval") return null;
  const id = doc.approvalLevel === 1 ? doc.approver1Id : doc.approvalLevel === 2 ? doc.approver2Id : null;
  return id ? String(id) : null;
}

/** Reset when a PO leaves the approval flow: both levels approve again next time. */
const CLEAR_APPROVAL = {
  approvalLevel: null,
  approved1At: null,
  approved1By: null,
  approved1ByName: "",
};

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function allocateOrderNumber(): Promise<string> {
  const parts = projectNumberParts();
  const scopeKey = `po:${parts.scopeKey}`;
  const counter = await PurchasingSeqCounterModel.findOneAndUpdate(
    { scopeKey },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey } },
    { upsert: true, new: true },
  ).exec();
  if (!counter || counter.nextSeq < 1) throw new Error("Failed to allocate PO number");
  return `PO/${parts.roman}/${parts.year}/${String(counter.nextSeq).padStart(4, "0")}`;
}

async function requireOrder(id: string): Promise<LeanOrder> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid PO id");
  const doc = (await PurchaseOrderRepo.model.findById(id).lean().exec()) as LeanOrder | null;
  if (!doc) throw new Error("PO not found");
  return doc;
}

async function displayName(userId: string): Promise<string> {
  const user = await UserModel.findById(userId).select({ fullName: 1, email: 1 }).lean().exec();
  return user?.fullName?.trim() || user?.email || "";
}

/** SPP lines by line id, with their SPP. */
async function requestEntries(lineIds: string[]): Promise<Map<string, RequestEntry>> {
  if (lineIds.length === 0) return new Map();
  const oids = lineIds.map((id) => new Types.ObjectId(id));
  const requests = (await PurchaseRequestRepo.model
    .find({ "lines._id": { $in: oids } })
    .lean()
    .exec()) as LeanRequest[];
  const wanted = new Set(lineIds);
  const out = new Map<string, RequestEntry>();
  for (const request of requests) {
    for (const line of request.lines) {
      const id = String(line._id);
      if (wanted.has(id)) {
        out.set(id, { request, line: line as RequestEntry["line"] });
      }
    }
  }
  return out;
}

type RabBudget = { unitPrice: string | null; qty: string };

/**
 * Which RAB an SPP / PO line is budgeted on: its Purchasing RAB, else the
 * project RAB (SPK SPPs). Null when there is neither.
 */
function budgetScope(src: {
  purchaseRabId?: Types.ObjectId | null;
  projectId?: Types.ObjectId | null;
}): string | null {
  if (src.purchaseRabId) return `rab:${String(src.purchaseRabId)}`;
  if (src.projectId) return `project:${String(src.projectId)}`;
  return null;
}

function scopeIds(scopes: Array<string | null>, prefix: "rab" | "project"): Types.ObjectId[] {
  return [...new Set(scopes)]
    .flatMap((s) => (s?.startsWith(`${prefix}:`) ? [s.slice(prefix.length + 1)] : []))
    .map((id) => new Types.ObjectId(id));
}

type ScopeBudget = { label: string; lines: Map<string, RabBudget> };

/** Per budget scope: its label and RAB unit price / qty per material×UOM. */
async function rabBudgets(scopes: Array<string | null>): Promise<Map<string, ScopeBudget>> {
  const [projectRabs, purchaseRabs] = await Promise.all([
    ProjectRabRepo.model
      .find({ projectId: { $in: scopeIds(scopes, "project") } })
      .select({ projectId: 1, lines: 1 })
      .lean()
      .exec(),
    PurchaseRabRepo.model
      .find({ _id: { $in: scopeIds(scopes, "rab") } })
      .select({ number: 1, title: 1, lines: 1 })
      .lean()
      .exec(),
  ]);
  const out = new Map<string, ScopeBudget>();
  for (const r of projectRabs) {
    out.set(`project:${String(r.projectId)}`, {
      label: "Project RAB",
      lines: new Map(
        rabRowsForPurchasing(r.lines).map((row) => [
          row.key,
          { unitPrice: row.unitPrice, qty: row.qty },
        ]),
      ),
    });
  }
  for (const r of purchaseRabs) {
    out.set(`rab:${String(r._id)}`, {
      label: `${r.number} · ${r.title}`,
      lines: new Map(r.lines.map((l) => [l.key, { unitPrice: l.unitPrice, qty: l.qty }])),
    });
  }
  return out;
}

/** Qty on live POs per budget scope and material×UOM, optionally leaving one PO out. */
async function scopeOrderedQty(
  scopes: Array<string | null>,
  exceptOrderId?: string,
): Promise<Map<string, Map<string, Decimal>>> {
  const wanted = new Set(scopes.filter((s): s is string => s !== null));
  if (wanted.size === 0) return new Map();
  const query: Record<string, unknown> = {
    $and: [
      {
        $or: [
          { "lines.projectId": { $in: scopeIds(scopes, "project") } },
          { "lines.purchaseRabId": { $in: scopeIds(scopes, "rab") } },
        ],
      },
      PURCHASE_ORDER_HOLDING_QUERY,
    ],
  };
  if (exceptOrderId) query._id = { $ne: new Types.ObjectId(exceptOrderId) };
  const orders = await PurchaseOrderRepo.model
    .find(query)
    .select({ status: 1, lines: 1 })
    .lean()
    .exec();
  const out = new Map<string, Map<string, Decimal>>();
  for (const o of orders) {
    for (const l of o.lines) {
      const scope = budgetScope(l);
      if (!scope || !wanted.has(scope)) continue;
      const byKey = out.get(scope) ?? new Map<string, Decimal>();
      const key = rabLineKey(String(l.materialItemId), String(l.itemUomId));
      byKey.set(key, (byKey.get(key) ?? new Decimal(0)).plus(heldLineQty(o.status, l)));
      out.set(scope, byKey);
    }
  }
  return out;
}

/** Per material×UOM: each vendor's last and lowest price on approved POs, cheapest first. */
async function priceHistory(keys: string[]): Promise<Map<string, VendorPriceOutDto[]>> {
  const wanted = new Set(keys);
  if (wanted.size === 0) return new Map();
  const materialIds = [...new Set(keys.map((k) => k.split(":")[0] ?? ""))]
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  const orders = await PurchaseOrderRepo.model
    .find({ status: "approved", "lines.materialItemId": { $in: materialIds } })
    .select({ number: 1, vendorId: 1, approvedAt: 1, lines: 1 })
    .sort({ approvedAt: -1 })
    .limit(1000)
    .lean()
    .exec();
  const rows = new Map<string, Map<string, VendorPriceOutDto>>();
  for (const o of orders) {
    const vendorId = String(o.vendorId);
    for (const l of o.lines) {
      const key = rabLineKey(String(l.materialItemId), String(l.itemUomId));
      if (!wanted.has(key)) continue;
      const byVendor = rows.get(key) ?? new Map<string, VendorPriceOutDto>();
      const row = byVendor.get(vendorId);
      if (!row) {
        // Newest orders come first, so the first one seen holds the last price.
        byVendor.set(vendorId, {
          vendorId,
          vendorName: "",
          lastPrice: l.unitPrice,
          lastOrderNumber: o.number,
          lastDate: iso(o.approvedAt),
          minPrice: l.unitPrice,
          orderCount: 1,
        });
      } else {
        row.orderCount += 1;
        if (new Decimal(l.unitPrice).lt(row.minPrice)) row.minPrice = l.unitPrice;
      }
      rows.set(key, byVendor);
    }
  }
  const vendorIds = [...new Set([...rows.values()].flatMap((m) => [...m.keys()]))];
  const vendors = await VendorRepo.model
    .find({ _id: { $in: vendorIds.map((id) => new Types.ObjectId(id)) } })
    .select({ name: 1 })
    .lean()
    .exec();
  const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
  return new Map(
    [...rows].map(([key, byVendor]) => [
      key,
      [...byVendor.values()]
        .map((r) => ({ ...r, vendorName: vendorName.get(r.vendorId) ?? "Unknown vendor" }))
        .sort((x, y) => new Decimal(x.lastPrice).cmp(y.lastPrice)),
    ]),
  );
}

/**
 * Project / SPK / material labels, RAB budget and price history for SPP lines.
 * `exceptOrderId`: the PO being edited, left out of the RAB qty already ordered.
 */
async function describeEntries(
  entries: RequestEntry[],
  exceptOrderId?: string,
): Promise<Map<string, LineBase>> {
  if (entries.length === 0) return new Map();
  const projectIds = [
    ...new Set(entries.flatMap((e) => (e.request.projectId ? [String(e.request.projectId)] : []))),
  ];
  const scopes = entries.map((e) => budgetScope(e.request));
  const spkIds = [
    ...new Set(
      entries.flatMap((e) =>
        e.request.productionOrderId ? [String(e.request.productionOrderId)] : [],
      ),
    ),
  ];
  const lineKeys = entries.map((e) =>
    rabLineKey(String(e.line.materialItemId), String(e.line.itemUomId)),
  );
  const [projects, spks, meta, budgets, ordered, history] = await Promise.all([
    ProjectRepo.model
      .find({ _id: { $in: projectIds.map((id) => new Types.ObjectId(id)) } })
      .select({ name: 1, projectNumber: 1 })
      .lean()
      .exec(),
    ProductionOrderRepo.model
      .find({ _id: { $in: spkIds.map((id) => new Types.ObjectId(id)) } })
      .select({ number: 1, shopDrawingItemId: 1 })
      .lean()
      .exec(),
    loadItemMeta(entries.map((e) => String(e.line.materialItemId))),
    rabBudgets(scopes),
    scopeOrderedQty(scopes, exceptOrderId),
    priceHistory(lineKeys),
  ]);
  const items = await ProjectShopDrawingItemRepo.model
    .find({ _id: { $in: spks.map((o) => o.shopDrawingItemId) } })
    .select({ code: 1, name: 1 })
    .lean()
    .exec();
  const projectById = new Map(projects.map((p) => [String(p._id), p]));
  const spkById = new Map(spks.map((o) => [String(o._id), o]));
  const itemById = new Map(items.map((i) => [String(i._id), i]));

  const out = new Map<string, LineBase>();
  for (const { request, line } of entries) {
    const projectId = request.projectId ? String(request.projectId) : null;
    const project = projectId ? projectById.get(projectId) : undefined;
    const scope = budgetScope(request);
    const scopeBudget = scope ? budgets.get(scope) : undefined;
    const spk = request.productionOrderId
      ? spkById.get(String(request.productionOrderId))
      : undefined;
    const item = spk ? itemById.get(String(spk.shopDrawingItemId)) : undefined;
    const materialItemId = String(line.materialItemId);
    const itemUomId = String(line.itemUomId);
    const key = rabLineKey(materialItemId, itemUomId);
    const budget = scopeBudget?.lines.get(key);
    out.set(String(line._id), {
      requestId: String(request._id),
      requestNumber: request.number,
      requestLineId: String(line._id),
      neededDate: request.neededDate,
      projectId,
      projectNumber: projectId ? (project?.projectNumber ?? "—") : "—",
      projectName: projectId ? (project?.name ?? "Unknown project") : "No project",
      productionOrderNumber: spk?.number ?? null,
      itemLabel: item ? shopDrawingItemLabel(item) : null,
      purchaseRabId: request.purchaseRabId ? String(request.purchaseRabId) : null,
      rabLabel: scopeBudget?.label ?? (request.purchaseRabId ? "Purchasing RAB" : null),
      materialItemId,
      materialCode: meta.items.get(materialItemId)?.code ?? "—",
      materialName: meta.items.get(materialItemId)?.name ?? "Unknown",
      itemUomId,
      uomSymbol: meta.uoms.get(itemUomId)?.symbol ?? "—",
      requestedQty: line.qty,
      source: line.source,
      inRab: line.inRab,
      overPlan: line.overPlan,
      note: line.note ?? "",
      rabUnitPrice: budget?.unitPrice ?? null,
      rabQty: budget?.qty ?? null,
      rabOrderedQty: formatDecimal((scope ? ordered.get(scope)?.get(key) : undefined) ?? new Decimal(0)),
      priceHistory: history.get(key) ?? [],
    });
  }
  return out;
}

function sortLines<T extends { materialName: string; requestNumber: string }>(rows: T[]): T[] {
  return rows.sort(
    (a, b) =>
      a.materialName.localeCompare(b.materialName) ||
      a.requestNumber.localeCompare(b.requestNumber),
  );
}

export class PurchaseOrderService {
  async vendorOptions(): Promise<PurchasingOptionOutDto[]> {
    const vendors = await VendorRepo.model
      .find({ isActive: { $ne: false } })
      .select({ name: 1, address: 1 })
      .sort({ name: 1 })
      .lean()
      .exec();
    return vendors.map((v) => ({ id: String(v._id), label: v.name, detail: v.address ?? "" }));
  }

  async termOptions(): Promise<PurchasingOptionOutDto[]> {
    const terms = await TermOfPaymentRepo.model
      .find({ isActive: { $ne: false } })
      .sort({ termOfPayment: 1 })
      .lean()
      .exec();
    return terms.map((t) => ({ id: String(t._id), label: t.termOfPayment, detail: "" }));
  }

  /** Users who may be picked as level 1 / level 2 approver. */
  async approverOptions(level: PurchaseOrderApprovalLevel): Promise<PurchasingOptionOutDto[]> {
    const users = await usersWithPermission(APPROVE_PERM[level]);
    return users.map((u) => ({
      id: String(u._id),
      label: u.fullName?.trim() || u.email || "",
      detail: u.email ?? "",
    }));
  }

  /** Lines of one submitted SPP that still have qty to order. */
  async openLines(requestId: string, exceptOrderId?: string): Promise<OpenRequestLineOutDto[]> {
    const request = (await PurchaseRequestRepo.model
      .findById(requestId)
      .lean()
      .exec()) as LeanRequest | null;
    if (!request) throw new Error("SPP not found");
    if (request.status !== "submitted") return [];
    const requests = [request];
    const ordered = sumOrdered(
      await liveOrderLines(requests.map((r) => r._id), exceptOrderId),
    );
    const entries: RequestEntry[] = requests.flatMap((request) =>
      request.lines
        .filter((line) => remainingToOrder(line.qty, ordered.get(String(line._id))).gt(0))
        .map((line) => ({ request, line: line as RequestEntry["line"] })),
    );
    const bases = await describeEntries(entries, exceptOrderId);
    return sortLines(
      entries.map((e) => {
        const id = String(e.line._id);
        const done = ordered.get(id) ?? new Decimal(0);
        return {
          ...bases.get(id)!,
          orderedQty: formatDecimal(done),
          remainingQty: formatDecimal(remainingToOrder(e.line.qty, done)),
        };
      }),
    );
  }

  async list(filter: {
    status?: PurchaseOrderStatusDto;
    requestId?: string;
    /** Only POs created by this user. */
    createdBy?: string;
    /** Only pending POs waiting on this user's approval now. */
    waitingOn?: string;
    ids?: string[];
    q?: string;
  }): Promise<PurchaseOrderSummaryOutDto[]> {
    const query: Record<string, unknown> = {};
    if (filter.createdBy) query.createdBy = new Types.ObjectId(filter.createdBy);
    if (filter.ids) query._id = { $in: filter.ids.map((id) => new Types.ObjectId(id)) };
    if (filter.status) query.status = filter.status;
    if (filter.requestId) query.requestId = new Types.ObjectId(filter.requestId);
    if (filter.waitingOn) {
      const me = new Types.ObjectId(filter.waitingOn);
      query.status = "pending_approval";
      query.$or = [
        { approvalLevel: 1, approver1Id: me },
        { approvalLevel: 2, approver2Id: me },
      ];
    }
    const docs = (await PurchaseOrderRepo.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec()) as LeanOrder[];
    const rows = await this.summaries(docs);
    const q = filter.q?.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.vendorName, r.requestNumber, r.projectNumber, r.projectName].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }

  async get(id: string, actor?: PoActor): Promise<PurchaseOrderOutDto> {
    const doc = await requireOrder(id);
    const notas = await PurchaseRealizationRepo.model
      .find({ purchaseOrderId: doc._id })
      .select({ number: 1, status: 1, method: 1, purchaseDate: 1, subtotal: 1, total: 1, lines: 1 })
      .sort({ purchaseDate: 1, createdAt: 1 })
      .lean()
      .exec();
    const posted = notas.filter((n) => n.status === "posted");
    const realized = sumRealized(
      posted.flatMap((n) => n.lines.map((l) => ({ poLineId: String(l.poLineId), qty: l.qty }))),
    );
    const approvedPrice = new Map(doc.lines.map((l) => [String(l._id), l.unitPrice]));
    const notaDiff = (n: (typeof notas)[number]) =>
      n.lines
        .reduce(
          (sum, l) =>
            sum
              .plus(lineAmount(l.qty, l.unitPrice))
              .minus(lineAmount(l.qty, approvedPrice.get(String(l.poLineId)) ?? l.unitPrice)),
          new Decimal(0),
        )
        .toFixed(0);
    const [summary] = await this.summaries([doc]);
    const lineIds = doc.lines.map((l) => String(l.requestLineId));
    const entries = await requestEntries(lineIds);
    const bases = await describeEntries([...entries.values()], id);
    const elsewhere = sumOrdered(
      await liveOrderLines([...new Set(doc.lines.map((l) => String(l.requestId)))], id),
    );
    const [term, names] = await Promise.all([
      doc.termOfPaymentId
        ? TermOfPaymentRepo.model.findById(doc.termOfPaymentId).select({ termOfPayment: 1 }).lean().exec()
        : Promise.resolve(null),
      userEmailsById(
        [
          doc.submittedBy,
          doc.approved1By,
          doc.approvedBy,
          doc.rejectedBy,
          doc.cancelledBy,
        ]
          .filter(Boolean)
          .map(String),
      ),
    ]);
    const ref = (oid: Types.ObjectId | null | undefined): ProjectRabUserRefOutDto | null =>
      oid ? { id: String(oid), name: names.get(String(oid)) ?? String(oid) } : null;

    let rabTotal = new Decimal(0);
    const lines = doc.lines.map((l): PurchaseOrderLineOutDto => {
      const lineId = String(l.requestLineId);
      const base = bases.get(lineId);
      const other = elsewhere.get(lineId) ?? new Decimal(0);
      const requested = base?.requestedQty ?? "0";
      const rabPrice = base?.rabUnitPrice ?? null;
      if (rabPrice) rabTotal = rabTotal.plus(lineAmount(l.qty, rabPrice));
      return {
        ...(base ?? {
          requestId: String(l.requestId),
          requestNumber: "—",
          requestLineId: lineId,
          neededDate: "",
          projectId: l.projectId ? String(l.projectId) : null,
          projectNumber: "—",
          projectName: "Unknown project",
          productionOrderNumber: null,
          itemLabel: null,
          purchaseRabId: l.purchaseRabId ? String(l.purchaseRabId) : null,
          rabLabel: null,
          materialItemId: String(l.materialItemId),
          materialCode: "—",
          materialName: "Unknown",
          itemUomId: String(l.itemUomId),
          uomSymbol: "—",
          requestedQty: "0",
          source: "extra",
          inRab: false,
          overPlan: false,
          note: "",
          rabUnitPrice: null,
          rabQty: null,
          rabOrderedQty: "0",
          priceHistory: [],
        }),
        id: String(l._id),
        qty: l.qty,
        unitPrice: l.unitPrice,
        amount: lineAmount(l.qty, l.unitPrice).toFixed(0),
        orderedElsewhereQty: formatDecimal(other),
        overRequest: new Decimal(l.qty).gt(remainingToOrder(requested, other)),
        overBudget: rabPrice !== null && new Decimal(l.unitPrice).gt(rabPrice),
        overRabQty:
          base?.rabQty != null &&
          new Decimal(base.rabOrderedQty).plus(l.qty).gt(base.rabQty),
        orderNote: l.note ?? "",
        realizedQty: formatDecimal(realized.get(String(l._id)) ?? new Decimal(0)),
      };
    });

    return {
      ...summary!,
      termOfPaymentId: doc.termOfPaymentId ? String(doc.termOfPaymentId) : null,
      termOfPayment: term?.termOfPayment ?? "",
      notes: doc.notes ?? "",
      lines: sortLines(lines),
      rabTotal: rabTotal.toFixed(0),
      submittedBy: ref(doc.submittedBy),
      approved1By: ref(doc.approved1By),
      approvedBy: ref(doc.approvedBy),
      quotation: await listQuotations(doc._id),
      estimatedCharges: estimatesOf(doc).charges,
      estimates: estimatesOut(doc),
      estimatedTotal: estimatesOf(doc).total,
      rejectedAt: iso(doc.rejectedAt),
      rejectedBy: ref(doc.rejectedBy),
      rejectReason: doc.rejectReason ?? "",
      cancelledAt: iso(doc.cancelledAt),
      cancelledBy: ref(doc.cancelledBy),
      cancelReason: doc.cancelReason ?? "",
      closedPartial: doc.closedPartial ?? false,
      canChange: actor ? isOwner(doc, actor) : false,
      canApprove: actor ? currentApprover(doc) === actor.userId : false,
      realizationStatus: realizationStatus(
        doc.lines.map((l) => ({ qty: l.qty, realized: realized.get(String(l._id)) })),
      ),
      realizedTotal: posted.reduce((sum, n) => sum.plus(n.total), new Decimal(0)).toFixed(0),
      // Legacy notas without a subtotal had no charges: their total is goods only.
      realizedSubtotal: posted
        .reduce((sum, n) => sum.plus(n.subtotal ?? n.total), new Decimal(0))
        .toFixed(0),
      realizations: notas.map((n) => ({
        id: String(n._id),
        number: n.number,
        status: n.status,
        method: n.method,
        purchaseDate: n.purchaseDate,
        total: n.total,
        difference: notaDiff(n),
      })),
    };
  }

  /**
   * Save SPP lines that each carry a vendor: one draft PO per vendor. When
   * editing (`id`), that PO keeps its vendor's lines (or the first vendor's,
   * if none are left) and the other vendors get new drafts.
   */
  async save(
    id: string | null,
    input: SavePurchaseOrdersInDto,
    actor: PoActor,
  ): Promise<SavePurchaseOrdersOutDto> {
    const groups = new Map<string, SavePurchaseOrderInDto["lines"]>();
    const seen = new Set<string>();
    for (const { vendorId, ...line } of input.lines) {
      if (seen.has(line.requestLineId)) throw new Error("An SPP line can be on one vendor only");
      seen.add(line.requestLineId);
      groups.set(vendorId, [...(groups.get(vendorId) ?? []), line]);
    }
    if (groups.size === 0) throw new Error("Add at least one item");

    const doc = id ? await requireOrder(id) : null;
    if (doc) {
      assertOwner(doc, actor);
      if (doc.status !== "draft") throw new Error("Only a draft PO can be edited");
      if (String(doc.requestId) !== input.requestId) {
        throw new Error("A PO cannot move to another SPP; make a new PO instead");
      }
    }
    const creatorId = doc ? String(doc.createdBy) : actor.userId;
    const vendors = [...groups.keys()];
    const mainVendor = doc && groups.has(String(doc.vendorId)) ? String(doc.vendorId) : vendors[0]!;
    const terms = new Map(input.terms.map((t) => [t.vendorId, t.termOfPaymentId]));
    const fieldsFor = (vendorId: string) =>
      // Reads skip the open transaction, so the edited PO's old lines are left
      // out for every vendor; each SPP line is on one vendor only.
      this.checkedFields(
        {
          requestId: input.requestId,
          vendorId,
          termOfPaymentId: terms.get(vendorId) ?? null,
          expectedDate: input.expectedDate,
          notes: input.notes,
          approver1Id: input.approver1Id,
          approver2Id: input.approver2Id,
          lines: groups.get(vendorId)!,
        },
        creatorId,
        id ?? undefined,
      );

    const ids = await withTx(async () => {
      const out: string[] = [];
      for (const vendorId of [mainVendor, ...vendors.filter((v) => v !== mainVendor)]) {
        const fields = await fieldsFor(vendorId);
        if (doc && vendorId === mainVendor) {
          const updated = await PurchaseOrderRepo.findOneAndUpdate(
            { _id: doc._id, status: "draft" },
            { $set: fields },
          );
          if (!updated) throw new Error("PO is no longer a draft");
          out.push(String(doc._id));
        } else {
          const created = await PurchaseOrderRepo.create({
            ...fields,
            number: await allocateOrderNumber(),
            status: "draft",
            createdBy: new Types.ObjectId(creatorId),
          });
          out.push(String(created._id));
        }
      }
      return out;
    });
    if (input.submit) {
      for (const orderId of ids) await this.submit(orderId, actor);
    }
    const [mainId, ...otherIds] = ids;
    const others = await PurchaseOrderRepo.model
      .find({ _id: { $in: otherIds.map((o) => new Types.ObjectId(o)) } })
      .lean()
      .exec();
    return {
      order: await this.get(mainId!, actor),
      others: await this.summaries(others as LeanOrder[]),
    };
  }

  async remove(id: string, actor: PoActor): Promise<void> {
    const doc = await requireOrder(id);
    assertOwner(doc, actor);
    if (doc.status !== "draft") throw new Error("Only a draft PO can be deleted; cancel it instead");
    const removed = await PurchaseOrderRepo.deleteOne({ _id: doc._id, status: "draft" });
    if (!removed) throw new Error("PO not found");
    await purgeQuotations(doc._id);
  }

  /** Send for approval; lines are checked again against the SPPs. */
  async submit(id: string, actor: PoActor): Promise<PurchaseOrderOutDto> {
    const userId = actor.userId;
    const doc = await requireOrder(id);
    assertOwner(doc, actor);
    if (doc.status !== "draft") throw new Error("Only a draft PO can be sent for approval");
    if (!doc.approver1Id || !doc.approver2Id) {
      throw new Error("Pick the level 1 and level 2 approver before sending");
    }
    await withTx(async () => {
      await this.checkedFields(
        {
          requestId: String(doc.requestId),
          vendorId: String(doc.vendorId),
          termOfPaymentId: doc.termOfPaymentId ? String(doc.termOfPaymentId) : null,
          expectedDate: doc.expectedDate ?? null,
          notes: doc.notes,
          approver1Id: String(doc.approver1Id),
          approver2Id: String(doc.approver2Id),
          lines: doc.lines.map((l) => ({
            requestLineId: String(l.requestLineId),
            qty: l.qty,
            unitPrice: l.unitPrice,
            note: l.note,
          })),
        },
        String(doc.createdBy),
        id,
      );
      await this.transition(doc, "draft", {
        ...CLEAR_APPROVAL,
        status: "pending_approval",
        approvalLevel: 1,
        submittedAt: new Date(),
        submittedBy: new Types.ObjectId(userId),
      });
    });
    await notifyPurchaseOrderEvent({
      kind: "po_submitted",
      orderId: id,
      actorUserId: userId,
    });
    return this.get(id, actor);
  }

  /** The chosen approver of the current level signs; level 1 hands over to level 2. */
  async approve(id: string, actor: PoActor): Promise<PurchaseOrderOutDto> {
    const userId = actor.userId;
    const doc = await requireOrder(id);
    const level = await this.assertCurrentApprover(doc, userId);
    const now = new Date();
    const name = await displayName(userId);
    if (level === 1) {
      await this.transition(
        doc,
        "pending_approval",
        {
          approvalLevel: 2,
          approved1At: now,
          approved1By: new Types.ObjectId(userId),
          approved1ByName: name,
        },
        { approvalLevel: 1 },
      );
      await notifyPurchaseOrderEvent({
        kind: "po_l1_approved",
        orderId: id,
        actorUserId: userId,
      });
    } else {
      await this.transition(
        doc,
        "pending_approval",
        {
          status: "approved",
          approvalLevel: null,
          approvedAt: now,
          approvedBy: new Types.ObjectId(userId),
          approvedByName: name,
        },
        { approvalLevel: 2 },
      );
      await notifyPurchaseOrderEvent({
        kind: "po_fully_approved",
        orderId: id,
        actorUserId: userId,
      });
    }
    return this.get(id, actor);
  }

  /** Either level may reject; both levels approve again after the next send. */
  async reject(id: string, actor: PoActor, reason: string): Promise<PurchaseOrderOutDto> {
    const userId = actor.userId;
    const doc = await requireOrder(id);
    const level = await this.assertCurrentApprover(doc, userId);
    await this.transition(
      doc,
      "pending_approval",
      {
        ...CLEAR_APPROVAL,
        status: "rejected",
        rejectedAt: new Date(),
        rejectedBy: new Types.ObjectId(userId),
        rejectReason: reason,
      },
      { approvalLevel: level },
    );
    await notifyPurchaseOrderEvent({
      kind: "po_rejected",
      orderId: id,
      actorUserId: userId,
    });
    return this.get(id, actor);
  }

  /**
   * Back to draft so purchasing can fix it, change approvers and resend: a
   * rejected PO, or a pending one pulled back (e.g. an approver is away).
   */
  async revise(id: string, actor: PoActor): Promise<PurchaseOrderOutDto> {
    const doc = await requireOrder(id);
    assertOwner(doc, actor);
    if (doc.status !== "rejected" && doc.status !== "pending_approval") {
      throw new Error("Only a rejected or pending PO can go back to draft");
    }
    // Once level 1 has signed, pulling it back would void their approval; reject instead.
    if (doc.status === "pending_approval" && doc.approved1At) {
      throw new Error("Level 1 already approved this PO; it can no longer go back to draft");
    }
    if (doc.status === "rejected") {
      // A rejected PO holds no qty, so its SPP may have been declined or cancelled meanwhile.
      const request = await PurchaseRequestRepo.model.findById(doc.requestId).select({ status: 1 }).lean().exec();
      if (request?.status !== "submitted") {
        throw new Error("The SPP of this PO is no longer open; cancel this PO instead");
      }
    }
    await this.transition(doc, doc.status, {
      ...CLEAR_APPROVAL,
      status: "draft",
      submittedAt: null,
      submittedBy: null,
    });
    return this.get(id, actor);
  }

  /** Estimated tax / delivery / other rows on a draft PO (empty = not estimated). */
  async setEstimates(
    id: string,
    charges: RealizationChargeInDto[],
    actor: PoActor,
  ): Promise<PurchaseOrderOutDto> {
    const doc = await requireOrder(id);
    assertOwner(doc, actor);
    if (doc.status !== "draft") throw new Error("Estimates can only be changed on a draft PO");
    const priced = checkRealizationCharges(doc.total, charges);
    const updated = await PurchaseOrderRepo.findOneAndUpdate(
      { _id: doc._id, status: "draft" },
      { $set: { estimatedCharges: priced.charges, estimates: null } },
    );
    if (!updated) throw new Error("PO is no longer a draft");
    return this.get(id, actor);
  }

  /** Vendor quotation versions change only on a draft PO, by its owner. */
  private async requireQuotationEditable(id: string, actor: PoActor): Promise<LeanOrder> {
    const doc = await requireOrder(id);
    assertOwner(doc, actor);
    if (doc.status !== "draft") throw new Error("Quotations can only be changed on a draft PO");
    return doc;
  }

  /** Upload a new version of the vendor quotation (PDF / photo); it becomes current. */
  async uploadQuotation(
    id: string,
    file: Express.Multer.File | undefined,
    force: boolean,
    actor: PoActor,
  ): Promise<PurchaseOrderOutDto & { linked: boolean }> {
    const doc = await this.requireQuotationEditable(id, actor);
    if (!file) throw new Error("Choose a file");
    const { linked } = await uploadQuotationVersion(doc._id, file, {
      force,
      userId: actor.userId,
    });
    return { ...(await this.get(id, actor)), linked };
  }

  async setCurrentQuotation(id: string, fileId: string, actor: PoActor): Promise<PurchaseOrderOutDto> {
    const doc = await this.requireQuotationEditable(id, actor);
    await setCurrentQuotation(doc._id, fileId);
    return this.get(id, actor);
  }

  async renameQuotation(
    id: string,
    fileId: string,
    originalFilename: string,
    actor: PoActor,
  ): Promise<PurchaseOrderOutDto> {
    const doc = await this.requireQuotationEditable(id, actor);
    await renameQuotation(doc._id, fileId, originalFilename);
    return this.get(id, actor);
  }

  async removeQuotation(id: string, fileId: string, actor: PoActor): Promise<PurchaseOrderOutDto> {
    const doc = await this.requireQuotationEditable(id, actor);
    await deleteQuotation(doc._id, fileId, actor.userId);
    return this.get(id, actor);
  }

  async openQuotation(id: string, fileId: string) {
    const doc = await requireOrder(id);
    return openQuotationVersion(doc._id, fileId);
  }

  async cancel(id: string, actor: PoActor, reason: string): Promise<PurchaseOrderOutDto> {
    const userId = actor.userId;
    const doc = await requireOrder(id);
    assertOwner(doc, actor);
    if (!["pending_approval", "approved", "rejected"].includes(doc.status)) {
      throw new Error(
        doc.status === "draft" ? "Delete a draft PO instead" : "This PO is already cancelled",
      );
    }
    const openPayments = await PurchasePaymentRepo.model
      .countDocuments({ kind: "vendor", purchaseOrderId: doc._id, status: { $in: ["pending_approval", "approved"] } })
      .exec();
    if (openPayments > 0) {
      throw new Error("This PO has payments waiting for approval or payment: cancel them first");
    }
    const notas = await PurchaseRealizationRepo.model
      .find({ purchaseOrderId: doc._id, status: { $ne: "voided" } })
      .select({ status: 1, lines: 1 })
      .lean()
      .exec();
    if (notas.some((n) => n.status === "draft")) {
      throw new Error("This PO has a draft realization: post or delete it before cancelling the PO");
    }
    const realized = sumRealized(
      notas.flatMap((n) => n.lines.map((l) => ({ poLineId: String(l.poLineId), qty: l.qty }))),
    );
    const progress = realizationStatus(
      doc.lines.map((l) => ({ qty: l.qty, realized: realized.get(String(l._id)) })),
    );
    if (progress === "full") {
      throw new Error("Everything on this PO was already received, so it cannot be cancelled");
    }
    // Partly received: keep what arrived on record, drop the rest.
    const partial = progress === "partial";
    await this.transition(doc, doc.status, {
      approvalLevel: null,
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: new Types.ObjectId(userId),
      cancelReason: reason,
      closedPartial: partial,
      ...(partial
        ? {
            lines: doc.lines.map((l) => ({
              ...l,
              closedQty: formatDecimal(realized.get(String(l._id)) ?? new Decimal(0)),
            })),
          }
        : {}),
    });
    return this.get(id, actor);
  }

  /** Only the approver picked for the level the PO waits on, still holding that permission. */
  private async assertCurrentApprover(
    doc: LeanOrder,
    userId: string,
  ): Promise<PurchaseOrderApprovalLevel> {
    if (doc.status !== "pending_approval") throw new Error("This PO is not waiting for approval");
    const level = doc.approvalLevel;
    const approverId = currentApprover(doc);
    if (!level || !approverId) {
      throw new Error("This PO has no approvers; send it back to draft and pick them");
    }
    if (approverId !== userId) {
      throw new Error(`Only the chosen level ${level} approver can act on this PO now`);
    }
    if (!(await userHasPermission(userId, APPROVE_PERM[level]))) {
      throw new Error(`You no longer have level ${level} approval permission`);
    }
    return level;
  }

  private async transition(
    doc: LeanOrder,
    from: PurchaseOrderStatus,
    set: Record<string, unknown>,
    also: Record<string, unknown> = {},
  ): Promise<void> {
    const updated = await PurchaseOrderRepo.findOneAndUpdate(
      { ...also, _id: doc._id, status: from },
      { $set: set },
    );
    if (!updated) throw new Error("The PO was changed by someone else; reload it");
  }

  /** Vendor, term, approvers and lines checked and shaped for storage. */
  private async checkedFields(
    input: SavePurchaseOrderInDto,
    creatorId: string,
    exceptOrderId?: string,
  ) {
    await assertApprovers(input.approver1Id, input.approver2Id, creatorId);
    const [vendor, term] = await Promise.all([
      VendorRepo.model.findById(input.vendorId).select({ isActive: 1 }).lean().exec(),
      input.termOfPaymentId
        ? TermOfPaymentRepo.model.findById(input.termOfPaymentId).select({ _id: 1 }).lean().exec()
        : Promise.resolve(null),
    ]);
    if (!vendor) throw new Error("Vendor not found");
    if (vendor.isActive === false) throw new Error("Vendor is inactive");
    if (input.termOfPaymentId && !term) throw new Error("Term of payment not found");

    const entries = await requestEntries(input.lines.map((l) => l.requestLineId));
    const requestIds = [...new Set([...entries.values()].map((e) => String(e.request._id)))];
    const orderedElsewhere = sumOrdered(await liveOrderLines(requestIds, exceptOrderId));
    const meta = await loadItemMeta([...entries.values()].map((e) => String(e.line.materialItemId)));
    const refs = new Map<string, RequestLineRef>(
      [...entries].map(([id, e]) => [
        id,
        {
          requestId: String(e.request._id),
          requestLineId: id,
          requestNumber: e.request.number,
          requestStatus: e.request.status,
          label: meta.items.get(String(e.line.materialItemId))?.name ?? "Material",
          qty: e.line.qty,
        },
      ]),
    );
    const checked = checkOrderLines({
      requestId: input.requestId,
      lines: input.lines,
      requestLines: refs,
      orderedElsewhere,
    });
    return {
      requestId: new Types.ObjectId(input.requestId),
      vendorId: new Types.ObjectId(input.vendorId),
      termOfPaymentId: input.termOfPaymentId ? new Types.ObjectId(input.termOfPaymentId) : null,
      expectedDate: input.expectedDate,
      notes: input.notes,
      approver1Id: new Types.ObjectId(input.approver1Id),
      approver2Id: new Types.ObjectId(input.approver2Id),
      total: checked.total,
      lines: checked.lines.map((l) => {
        const e = entries.get(l.requestLineId)!;
        return {
          requestId: e.request._id,
          requestLineId: e.line._id,
          projectId: e.request.projectId ?? null,
          productionOrderId: e.request.productionOrderId ?? null,
          purchaseRabId: e.request.purchaseRabId ?? null,
          materialItemId: e.line.materialItemId,
          itemUomId: e.line.itemUomId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          note: l.note,
        };
      }),
    };
  }

  /** The PO's lines beside every line of its RAB, matched by material×UOM. */
  async rabCompare(id: string): Promise<PurchaseOrderRabCompareOutDto> {
    const doc = await requireOrder(id);
    const [summary] = await this.summaries([doc]);
    const request = await PurchaseRequestRepo.model
      .findById(doc.requestId)
      .select({ projectId: 1, purchaseRabId: 1 })
      .lean()
      .exec();
    const scope = budgetScope(request ?? doc.lines[0] ?? {});
    type RabRow = { key: string; materialItemId: string; itemUomId: string; qty: string; unitPrice: string | null };
    let rab: PurchaseOrderRabCompareOutDto["rab"] = null;
    let rabRows: RabRow[] = [];
    let rabCharges: PurchaseCharge[] = [];
    if (scope?.startsWith("rab:")) {
      const r = await PurchaseRabRepo.model.findById(scope.slice(4)).lean().exec();
      if (r) {
        rabCharges = r.charges ?? [];
        rabRows = r.lines.map((l) => ({
          key: l.key,
          materialItemId: String(l.materialItemId),
          itemUomId: String(l.itemUomId),
          qty: l.qty,
          unitPrice: l.unitPrice,
        }));
        rab = {
          label: `${r.number} · ${r.title}`,
          purchaseRabId: String(r._id),
          projectId: null,
          status: r.status,
          total: "0",
          chargesTotal: "0",
          chargesByCategory: { tax: "0", delivery: "0", other: "0" },
        };
      }
    } else if (scope?.startsWith("project:")) {
      const projectId = scope.slice(8);
      const r = await ProjectRabRepo.model
        .findOne({ projectId: new Types.ObjectId(projectId) })
        .lean()
        .exec();
      if (r) {
        rabRows = rabRowsForPurchasing(r.lines);
        rabCharges = r.charges ?? [];
        rab = {
          label: "Project RAB",
          purchaseRabId: null,
          projectId,
          status: r.status,
          total: "0",
          chargesTotal: "0",
          chargesByCategory: { tax: "0", delivery: "0", other: "0" },
        };
      }
    }
    const ordered = scope ? (await scopeOrderedQty([scope], id)).get(scope) : undefined;

    const poByKey = new Map<string, { materialItemId: string; itemUomId: string; qty: Decimal; amount: Decimal; prices: Set<string> }>();
    for (const l of doc.lines) {
      const materialItemId = String(l.materialItemId);
      const itemUomId = String(l.itemUomId);
      const key = rabLineKey(materialItemId, itemUomId);
      const row = poByKey.get(key) ?? { materialItemId, itemUomId, qty: new Decimal(0), amount: new Decimal(0), prices: new Set<string>() };
      row.qty = row.qty.plus(l.qty);
      row.amount = row.amount.plus(lineAmount(l.qty, l.unitPrice));
      row.prices.add(l.unitPrice);
      poByKey.set(key, row);
    }
    const meta = await loadItemMeta([
      ...rabRows.map((r) => r.materialItemId),
      ...[...poByKey.values()].map((r) => r.materialItemId),
    ]);
    const describe = (key: string, materialItemId: string, itemUomId: string) => ({
      key,
      materialItemId,
      materialCode: meta.items.get(materialItemId)?.code ?? "—",
      materialName: meta.items.get(materialItemId)?.name ?? "Unknown",
      uomSymbol: meta.uoms.get(itemUomId)?.symbol ?? "—",
    });
    // Posted realizations: actual qty and cost per material×UOM.
    const notas = await PurchaseRealizationRepo.model
      .find({ purchaseOrderId: doc._id, status: "posted" })
      .select({ lines: 1, subtotal: 1, chargesTotal: 1, charges: 1 })
      .lean()
      .exec();
    const keyOfPoLine = new Map(
      doc.lines.map((l) => [String(l._id), rabLineKey(String(l.materialItemId), String(l.itemUomId))]),
    );
    const realizedByKey = new Map<string, { qty: Decimal; amount: Decimal }>();
    let realizedSubtotal = new Decimal(0);
    let realizedCharges = new Decimal(0);
    for (const n of notas) {
      realizedSubtotal = realizedSubtotal.plus(n.subtotal || 0);
      realizedCharges = realizedCharges.plus(n.chargesTotal || 0);
      for (const l of n.lines) {
        const key = keyOfPoLine.get(String(l.poLineId));
        if (!key) continue;
        const row = realizedByKey.get(key) ?? { qty: new Decimal(0), amount: new Decimal(0) };
        row.qty = row.qty.plus(l.qty);
        row.amount = row.amount.plus(lineAmount(l.qty, l.unitPrice));
        realizedByKey.set(key, row);
      }
    }

    const poFields = (key: string) => {
      const po = poByKey.get(key);
      if (!po) {
        return {
          poQty: null,
          poUnitPrice: null,
          poAmount: null,
          realizedQty: null,
          realizedUnitPrice: null,
          realizedAmount: null,
        };
      }
      const [onlyPrice] = po.prices;
      const real = realizedByKey.get(key);
      return {
        poQty: formatDecimal(po.qty),
        // Same item at different prices: show the weighted average.
        poUnitPrice: po.prices.size === 1 && onlyPrice ? onlyPrice : po.amount.div(po.qty).toFixed(0),
        poAmount: po.amount.toFixed(0),
        realizedQty: formatDecimal(real?.qty ?? new Decimal(0)),
        realizedUnitPrice: real && real.qty.gt(0) ? real.amount.div(real.qty).toFixed(0) : null,
        realizedAmount: (real?.amount ?? new Decimal(0)).toFixed(0),
      };
    };
    const otherOrderedQty = (key: string) => formatDecimal(ordered?.get(key) ?? new Decimal(0));

    let rabTotal = new Decimal(0);
    const lines: PurchaseOrderRabCompareLineOutDto[] = rabRows.map((r) => {
      const amount = r.unitPrice ? lineAmount(r.qty, r.unitPrice) : null;
      if (amount) rabTotal = rabTotal.plus(amount);
      return {
        ...describe(r.key, r.materialItemId, r.itemUomId),
        rabQty: r.qty,
        rabUnitPrice: r.unitPrice,
        rabAmount: amount ? amount.toFixed(0) : null,
        otherOrderedQty: otherOrderedQty(r.key),
        ...poFields(r.key),
      };
    });
    const onRab = new Set(rabRows.map((r) => r.key));
    for (const [key, po] of poByKey) {
      if (onRab.has(key)) continue;
      lines.push({
        ...describe(key, po.materialItemId, po.itemUomId),
        rabQty: null,
        rabUnitPrice: null,
        rabAmount: null,
        otherOrderedQty: otherOrderedQty(key),
        ...poFields(key),
      });
    }
    if (rab) {
      rab.total = rabTotal.toFixed(0);
      // The RAB's own tax / delivery / other budget, percents on its goods total.
      const priced = priceStoredCharges(rab.total, rabCharges);
      rab.chargesTotal = priced.chargesTotal;
      rab.chargesByCategory = priced.byCategory;
    }
    return {
      orderId: String(doc._id),
      orderNumber: doc.number,
      status: doc.status,
      vendorName: summary!.vendorName,
      projectNumber: summary!.projectNumber,
      projectName: summary!.projectName,
      rab,
      poTotal: doc.total,
      realizedSubtotal: realizedSubtotal.toFixed(0),
      realizedCharges: realizedCharges.toFixed(0),
      realizedChargesByCategory: chargesByCategory(notas.flatMap((n) => n.charges ?? [])),
      estimates: estimatesOut(doc),
      realizationCount: notas.length,
      lines: lines.sort((a, b) => a.materialName.localeCompare(b.materialName)),
    };
  }

  private async summaries(docs: LeanOrder[]): Promise<PurchaseOrderSummaryOutDto[]> {
    if (docs.length === 0) return [];
    const vendorIds = [...new Set(docs.map((d) => String(d.vendorId)))];
    const requestOf = (d: LeanOrder) =>
      String(d.requestId ?? d.lines[0]?.requestId ?? "");
    const projectIds = [
      ...new Set(docs.flatMap((d) => d.lines.flatMap((l) => (l.projectId ? [String(l.projectId)] : [])))),
    ];
    const scopes = docs.flatMap((d) => d.lines.map((l) => budgetScope(l)));
    const requestIds = [...new Set(docs.map(requestOf).filter(Boolean))];
    const docIds = docs.map((d) => d._id);
    const [vendors, projects, requests, names, budgets, receipts, paidPayments] = await Promise.all([
      VendorRepo.model
        .find({ _id: { $in: vendorIds.map((id) => new Types.ObjectId(id)) } })
        .select({ name: 1 })
        .lean()
        .exec(),
      ProjectRepo.model
        .find({ _id: { $in: projectIds.map((id) => new Types.ObjectId(id)) } })
        .select({ projectNumber: 1, name: 1 })
        .lean()
        .exec(),
      PurchaseRequestRepo.model
        .find({ _id: { $in: requestIds.map((id) => new Types.ObjectId(id)) } })
        .select({ number: 1, projectId: 1, purchaseRabId: 1 })
        .lean()
        .exec(),
      userEmailsById(
        docs.flatMap((d) =>
          [d.createdBy, d.approver1Id, d.approver2Id].filter(Boolean).map(String),
        ),
      ),
      rabBudgets(scopes),
      PurchaseRealizationRepo.model
        .find({ purchaseOrderId: { $in: docIds }, status: "posted" })
        .select({ lines: 1 })
        .lean()
        .exec(),
      PurchasePaymentRepo.model
        .find({ kind: "vendor", purchaseOrderId: { $in: docIds }, status: "paid" })
        .select({ purchaseOrderId: 1, amount: 1 })
        .lean()
        .exec(),
    ]);
    const realizedByLine = sumRealized(
      receipts.flatMap((r) => r.lines.map((l) => ({ poLineId: String(l.poLineId), qty: l.qty }))),
    );
    const paidByOrder = new Map<string, Decimal>();
    for (const p of paidPayments) {
      const key = String(p.purchaseOrderId);
      paidByOrder.set(key, (paidByOrder.get(key) ?? new Decimal(0)).plus(p.amount));
    }
    const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
    const projectById = new Map(projects.map((p) => [String(p._id), p]));
    const requestById = new Map(requests.map((r) => [String(r._id), r]));
    const projectOf = (d: LeanOrder) =>
      String(requestById.get(requestOf(d))?.projectId ?? d.lines[0]?.projectId ?? "");
    const rabOf = (d: LeanOrder) =>
      requestById.get(requestOf(d))?.purchaseRabId ?? d.lines[0]?.purchaseRabId ?? null;
    return docs.map((d) => {
      const createdBy = d.createdBy ? String(d.createdBy) : null;
      const userRef = (oid: Types.ObjectId | null | undefined) =>
        oid ? { id: String(oid), name: names.get(String(oid)) ?? String(oid) } : null;
      const scope = d.lines[0] ? budgetScope(d.lines[0]) : null;
      const project = projectById.get(projectOf(d));
      const rabId = rabOf(d);
      const overBudgetCount = d.lines.filter((l) => {
        const lineScope = budgetScope(l);
        const price = (lineScope ? budgets.get(lineScope) : undefined)
          ?.lines.get(rabLineKey(String(l.materialItemId), String(l.itemUomId)))?.unitPrice;
        return price != null && new Decimal(l.unitPrice).gt(price);
      }).length;
      return {
        id: String(d._id),
        number: d.number,
        status: d.status,
        vendorId: String(d.vendorId),
        vendorName: vendorName.get(String(d.vendorId)) ?? "Unknown vendor",
        total: d.total,
        estimatedTotal: estimatesOf(d).total,
        lineCount: d.lines.length,
        overBudgetCount,
        requestId: requestOf(d),
        requestNumber: requestById.get(requestOf(d))?.number ?? "—",
        projectNumber: project?.projectNumber ?? "—",
        projectName: project?.name ?? (rabId ? "No project" : "Unknown project"),
        purchaseRabId: rabId ? String(rabId) : null,
        rabLabel: (scope ? budgets.get(scope)?.label : undefined) ?? null,
        expectedDate: d.expectedDate ?? null,
        createdBy: createdBy ? { id: createdBy, name: names.get(createdBy) ?? createdBy } : null,
        createdAt: iso(d.createdAt),
        submittedAt: iso(d.submittedAt),
        approver1: userRef(d.approver1Id),
        approver2: userRef(d.approver2Id),
        approvalLevel: d.status === "pending_approval" ? d.approvalLevel ?? null : null,
        approved1At: iso(d.approved1At),
        approvedAt: iso(d.approvedAt),
        receiptStatus: realizationStatus(
          d.lines.map((l) => ({ qty: l.qty, realized: realizedByLine.get(String(l._id)) })),
        ),
        paidTotal: (paidByOrder.get(String(d._id)) ?? new Decimal(0)).toFixed(0),
      };
    });
  }
}

export const purchaseOrderService = new PurchaseOrderService();

function rupiah(digits: string): string {
  return `Rp ${new Intl.NumberFormat("id-ID").format(Number(digits))}`;
}

function lineDetails(l: PurchaseOrderLineOutDto): string[] {
  const onRab = l.purchaseRabId !== null;
  const flags = [
    l.source === "extra" ? (onRab ? "Di luar RAB" : "Di luar SPK") : null,
    l.overPlan ? (onRab ? "Melebihi RAB" : "Melebihi kebutuhan SPK") : null,
    !l.inRab ? "Tidak ada di RAB" : null,
    l.overRequest ? "Lebih dari permintaan" : null,
  ].filter(Boolean);
  return [
    flags.length > 0 ? flags.join(" · ") : null,
    l.note ? `Alasan: ${l.note}` : null,
    l.orderNote ? `Catatan: ${l.orderNote}` : null,
  ].filter((x): x is string => Boolean(x));
}

/**
 * PO as a printable PDF, by status:
 * - waiting approval: Pengajuan Pembelian for management (RAB prices, QR to approve);
 * - approved: Pesanan Pembelian for the vendor;
 * - anything else: the vendor PO marked DRAFT.
 */
export async function exportPurchaseOrderPdf(
  id: string,
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const order = await purchaseOrderService.get(id);
  const doc = await requireOrder(id);
  const [vendor, request] = await Promise.all([
    VendorRepo.model.findById(order.vendorId).select({ name: 1, address: 1, npwp: 1 }).lean().exec(),
    PurchaseRequestRepo.model.findById(doc.requestId).select({ createdBy: 1, neededDate: 1 }).lean().exec(),
  ]);
  const creatorName = doc.createdBy ? await displayName(String(doc.createdBy)) : "";
  const requesterName = request?.createdBy ? await displayName(String(request.createdBy)) : "";
  const { companyName, letterhead } = companyLetterhead();
  const approved = order.status === "approved";
  const pending = order.status === "pending_approval";
  const spk = order.lines.find((l) => l.productionOrderNumber);
  const signedOn = (at: string | null) => (at ? formatLongDate(new Date(at)) : null);
  const approver1Name = doc.approver1Id ? await displayName(String(doc.approver1Id)) : "";
  const approver2Name = doc.approver2Id ? await displayName(String(doc.approver2Id)) : "";
  const approvalSignatures: PoPdfData["signatures"] = [
    ["Disetujui (Level 1),", doc.approved1ByName || null, signedOn(order.approved1At)],
    ["Disetujui (Level 2),", doc.approvedByName || null, signedOn(order.approvedAt)],
  ];
  const quotation = order.quotation.current;
  const estimateParts = (
    [
      ["Pajak", order.estimates.tax],
      ["Pengiriman", order.estimates.delivery],
      ["Lainnya", order.estimates.other],
    ] as const
  ).flatMap(([label, amount]) => (amount ? [`${label} ${rupiah(amount)}`] : []));
  const attachments = [
    ...(quotation
      ? [`Lampiran penawaran vendor: v${quotation.version} · ${quotation.originalFilename}`]
      : []),
    ...(estimateParts.length > 0
      ? [
          `Estimasi biaya tambahan: ${estimateParts.join(", ")} (perkiraan total ${rupiah(order.estimatedTotal)})`,
        ]
      : []),
  ];

  const lines: PoPdfData["lines"] = order.lines.map((l) => ({
    code: l.materialCode,
    name: l.materialName,
    details: pending ? lineDetails(l) : [],
    qty: l.qty,
    uom: l.uomSymbol,
    unitPrice: rupiah(l.unitPrice),
    rabPrice: l.rabUnitPrice ? rupiah(l.rabUnitPrice) : "-",
    aboveRab: l.overBudget,
    amount: rupiah(l.amount),
  }));

  let data: PoPdfData;
  let prefix: string;
  if (pending) {
    const url = `${env.frontendUrl.replace(/\/+$/, "")}/dashboard/purchasing/approvals/${order.id}`;
    const qrPng = await QRCode.toBuffer(url, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 360,
    });
    const diff = new Decimal(order.total).minus(order.rabTotal);
    const submittedAt = order.submittedAt ? new Date(order.submittedAt) : new Date();
    data = {
      layout: "approval",
      companyName,
      letterhead,
      title: "PENGAJUAN PEMBELIAN",
      subtitle: "Menunggu persetujuan",
      number: order.number,
      meta: {
        left: [
          ["Proyek", `${order.projectNumber} · ${order.projectName}`],
          spk || !order.rabLabel
            ? ["SPK", spk ? `${spk.productionOrderNumber}${spk.itemLabel ? ` · ${spk.itemLabel}` : ""}` : "-"]
            : ["RAB", order.rabLabel],
          ["Ref. SPP", order.requestNumber],
          ["Diminta oleh", requesterName || "-"],
          ["Dibutuhkan", ymdLong(request?.neededDate ?? null)],
          ["Approver L1", approver1Name || "-"],
          ["Approver L2", approver2Name || "-"],
        ],
        right: [
          ["No. PO", order.number],
          ["Diajukan", formatLongDate(submittedAt)],
          ["Vendor", vendor?.name ?? order.vendorName],
          ["Termin bayar", order.termOfPayment || "-"],
          ["Tgl. kirim", ymdLong(order.expectedDate)],
        ],
      },
      lines,
      total: rupiah(order.total),
      budget:
        new Decimal(order.rabTotal).gt(0)
          ? {
              rabTotal: rupiah(order.rabTotal),
              difference: `${diff.isNeg() ? "-" : ""}${rupiah(diff.abs().toFixed(0))}`,
              over: diff.gt(0),
            }
          : null,
      notes: [...splitLines(order.notes), ...attachments],
      approvalLink: { url, qrPng },
      signDate: formatLongDate(submittedAt),
      signatures: [
        ["Diajukan oleh,", creatorName || null, signedOn(order.submittedAt)],
        ...approvalSignatures,
      ],
    };
    prefix = "Pengajuan_PO";
  } else {
    const issuedAt = order.approvedAt ? new Date(order.approvedAt) : new Date();
    data = {
      layout: "vendor",
      companyName,
      letterhead,
      title: `PESANAN PEMBELIAN${approved ? "" : " (DRAFT)"}`,
      subtitle: null,
      number: order.number,
      meta: {
        left: [
          ["Kepada", vendor?.name ?? order.vendorName],
          ["Alamat", vendor?.address || "-"],
          ["NPWP", vendor?.npwp || "-"],
        ],
        right: [
          ["No. PO", order.number],
          ["Tanggal", formatLongDate(issuedAt)],
          ["Termin bayar", order.termOfPayment || "-"],
          ["Tgl. kirim", ymdLong(order.expectedDate)],
          ["Ref. SPP", order.requestNumber],
        ],
      },
      lines,
      total: rupiah(order.total),
      budget: null,
      notes: splitLines(order.notes),
      approvalLink: null,
      signDate: formatLongDate(issuedAt),
      signatures: [["Dibuat oleh,", creatorName || null, null], ...approvalSignatures],
    };
    prefix = approved ? "PO" : "PO_DRAFT";
  }

  const filename = [prefix, safeFilenamePart(order.number), formatExportYmd()].join("_");
  return {
    buffer: await buildPoPdf(data, await loadCompanyLogo()),
    filename: `${filename}.pdf`,
    contentType: "application/pdf",
  };
}
