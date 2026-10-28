import Decimal from "decimal.js";
import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import type {
  OpenRequestLineOutDto,
  PurchaseOrderLineOutDto,
  PurchaseOrderOutDto,
  PurchaseOrderStatusDto,
  PurchaseOrderSummaryOutDto,
  PurchasingOptionOutDto,
  SavePurchaseOrderInDto,
} from "../../dto/purchasing.dto";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import { ProductionOrderRepo } from "../../models/productionOrder/productionOrder.model";
import { ProjectRepo } from "../../models/project/project.model";
import { ProjectRabRepo } from "../../models/projectRab/projectRab.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem/projectShopDrawingItem.model";
import {
  PurchaseOrderRepo,
  type PurchaseOrderInterface,
  type PurchaseOrderStatus,
} from "../../models/purchaseOrder/purchaseOrder.model";
import {
  PurchaseRequestRepo,
  type PurchaseRequestInterface,
  type PurchaseRequestLine,
} from "../../models/purchaseRequest/purchaseRequest.model";
import { PurchasingSeqCounterModel } from "../../models/seqCounter/seqCounter.model";
import { TermOfPaymentRepo } from "../../models/termOfPayment/termOfPayment.model";
import { UserModel } from "../../models/user/user.model";
import { VendorRepo } from "../../models/vendor/vendor.model";
import { userEmailsById } from "../../utils/shared";
import { loadItemMeta } from "../itemMaster/itemMeta";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { projectNumberParts } from "../project/projectNumber";
import { rabLineKey } from "../project/projectRab.planner";
import { shopDrawingItemLabel } from "../project/projectShared";
import {
  checkOrderLines,
  lineAmount,
  remainingToOrder,
  sumOrdered,
  type RequestLineRef,
} from "./purchaseOrder.planner";
import { liveOrderLines } from "./purchaseOrderLines";
import { PurchaseRealizationRepo } from "../../models/purchaseRealization/purchaseRealization.model";
import { realizationStatus, sumRealized } from "./purchaseRealization.planner";
import { GoodsReceiptRepo } from "../../models/goodsReceipt/goodsReceipt.model";
import QRCode from "qrcode";
import { env } from "../../environment/env";
import { buildPoPdf, type PoPdfData } from "./purchaseOrder.pdf";
import {
  companyLetterhead,
  loadCompanyLogo,
  ymdLong,
} from "../production/production.service";
import { formatExportYmd, safeFilenamePart } from "../project/projectRabExport.planner";
import { formatLongDate, splitLines } from "../quotation/quotation.document";

type LeanOrder = PurchaseOrderInterface & { _id: Types.ObjectId };
type LeanRequest = PurchaseRequestInterface & { _id: Types.ObjectId };
type RequestEntry = { request: LeanRequest; line: PurchaseRequestLine & { _id: Types.ObjectId } };
type LineBase = Omit<OpenRequestLineOutDto, "orderedQty" | "remainingQty">;

/** Who is acting on a PO: only its creator (or super admin) may change it. */
export type PoActor = { userId: string; superAdmin: boolean };

function isOwner(doc: LeanOrder, actor: PoActor): boolean {
  return actor.superAdmin || String(doc.createdBy) === actor.userId;
}

function assertOwner(doc: LeanOrder, actor: PoActor): void {
  if (!isOwner(doc, actor)) {
    throw new Error("Only the person who created this PO can change it");
  }
}

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

/** RAB unit price per project and material×UOM. */
async function rabPrices(projectIds: string[]): Promise<Map<string, Map<string, string>>> {
  const rabs = await ProjectRabRepo.model
    .find({ projectId: { $in: [...new Set(projectIds)].map((id) => new Types.ObjectId(id)) } })
    .select({ projectId: 1, lines: 1 })
    .lean()
    .exec();
  return new Map(
    rabs.map((r) => [
      String(r.projectId),
      new Map(
        r.lines
          .filter((l) => l.unitPrice && String(l.unitPrice).trim() !== "")
          .map((l) => [l.key, String(l.unitPrice)]),
      ),
    ]),
  );
}

/** Project / SPK / material labels and RAB price for SPP lines. */
async function describeEntries(entries: RequestEntry[]): Promise<Map<string, LineBase>> {
  if (entries.length === 0) return new Map();
  const projectIds = [...new Set(entries.map((e) => String(e.request.projectId)))];
  const spkIds = [
    ...new Set(
      entries.flatMap((e) =>
        e.request.productionOrderId ? [String(e.request.productionOrderId)] : [],
      ),
    ),
  ];
  const [projects, spks, meta, prices] = await Promise.all([
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
    rabPrices(projectIds),
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
    const projectId = String(request.projectId);
    const project = projectById.get(projectId);
    const spk = request.productionOrderId
      ? spkById.get(String(request.productionOrderId))
      : undefined;
    const item = spk ? itemById.get(String(spk.shopDrawingItemId)) : undefined;
    const materialItemId = String(line.materialItemId);
    const itemUomId = String(line.itemUomId);
    out.set(String(line._id), {
      requestId: String(request._id),
      requestNumber: request.number,
      requestLineId: String(line._id),
      neededDate: request.neededDate,
      projectId,
      projectNumber: project?.projectNumber ?? "—",
      projectName: project?.name ?? "Unknown project",
      productionOrderNumber: spk?.number ?? null,
      itemLabel: item ? shopDrawingItemLabel(item) : null,
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
      rabUnitPrice: prices.get(projectId)?.get(rabLineKey(materialItemId, itemUomId)) ?? null,
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
    const bases = await describeEntries(entries);
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
    ids?: string[];
    q?: string;
  }): Promise<PurchaseOrderSummaryOutDto[]> {
    const query: Record<string, unknown> = {};
    if (filter.createdBy) query.createdBy = new Types.ObjectId(filter.createdBy);
    if (filter.ids) query._id = { $in: filter.ids.map((id) => new Types.ObjectId(id)) };
    if (filter.status) query.status = filter.status;
    if (filter.requestId) query.requestId = new Types.ObjectId(filter.requestId);
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
      .select({ number: 1, status: 1, purchaseDate: 1, total: 1, lines: 1 })
      .sort({ purchaseDate: 1, createdAt: 1 })
      .lean()
      .exec();
    const posted = notas.filter((n) => n.status === "posted");
    const realized = sumRealized(
      posted.flatMap((n) => n.lines.map((l) => ({ poLineId: String(l.poLineId), qty: l.qty }))),
    );
    const approvedPrice = new Map(doc.lines.map((l) => [String(l._id), l.unitPrice]));
    const receipts = await GoodsReceiptRepo.model
      .find({ purchaseOrderId: doc._id })
      .select({ number: 1, status: 1, receivedDate: 1, lines: 1 })
      .sort({ receivedDate: 1, createdAt: 1 })
      .lean()
      .exec();
    const received = sumRealized(
      receipts
        .filter((r) => r.status === "posted")
        .flatMap((r) => r.lines.map((l) => ({ poLineId: String(l.poLineId), qty: l.qty }))),
    );
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
    const bases = await describeEntries([...entries.values()]);
    const elsewhere = sumOrdered(
      await liveOrderLines([...new Set(doc.lines.map((l) => String(l.requestId)))], id),
    );
    const [term, names] = await Promise.all([
      doc.termOfPaymentId
        ? TermOfPaymentRepo.model.findById(doc.termOfPaymentId).select({ termOfPayment: 1 }).lean().exec()
        : Promise.resolve(null),
      userEmailsById(
        [doc.submittedBy, doc.approvedBy, doc.rejectedBy, doc.cancelledBy].filter(Boolean).map(String),
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
          projectId: String(l.projectId),
          projectNumber: "—",
          projectName: "Unknown project",
          productionOrderNumber: null,
          itemLabel: null,
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
        }),
        id: String(l._id),
        qty: l.qty,
        unitPrice: l.unitPrice,
        amount: lineAmount(l.qty, l.unitPrice).toFixed(0),
        orderedElsewhereQty: formatDecimal(other),
        overRequest: new Decimal(l.qty).gt(remainingToOrder(requested, other)),
        overBudget: rabPrice !== null && new Decimal(l.unitPrice).gt(rabPrice),
        orderNote: l.note ?? "",
        realizedQty: formatDecimal(realized.get(String(l._id)) ?? new Decimal(0)),
        receivedQty: formatDecimal(received.get(String(l._id)) ?? new Decimal(0)),
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
      approvedBy: ref(doc.approvedBy),
      rejectedAt: iso(doc.rejectedAt),
      rejectedBy: ref(doc.rejectedBy),
      rejectReason: doc.rejectReason ?? "",
      cancelledAt: iso(doc.cancelledAt),
      cancelledBy: ref(doc.cancelledBy),
      cancelReason: doc.cancelReason ?? "",
      canChange: actor ? isOwner(doc, actor) : false,
      realizationStatus: realizationStatus(
        doc.lines.map((l) => ({ qty: l.qty, realized: realized.get(String(l._id)) })),
      ),
      realizedTotal: posted.reduce((sum, n) => sum.plus(n.total), new Decimal(0)).toFixed(0),
      realizations: notas.map((n) => ({
        id: String(n._id),
        number: n.number,
        status: n.status,
        purchaseDate: n.purchaseDate,
        total: n.total,
        difference: notaDiff(n),
      })),
      receiptStatus: realizationStatus(
        doc.lines.map((l) => ({ qty: l.qty, realized: received.get(String(l._id)) })),
      ),
      receipts: receipts.map((r) => ({
        id: String(r._id),
        number: r.number,
        status: r.status,
        receivedDate: r.receivedDate,
        lineCount: r.lines.length,
      })),
    };
  }

  async create(input: SavePurchaseOrderInDto, actor: PoActor): Promise<PurchaseOrderOutDto> {
    const userId = actor.userId;
    const created = await withTx(async () => {
      const fields = await this.checkedFields(input);
      return PurchaseOrderRepo.create({
        ...fields,
        number: await allocateOrderNumber(),
        status: "draft",
        createdBy: new Types.ObjectId(userId),
      });
    });
    return this.get(String(created._id), actor);
  }

  async update(
    id: string,
    input: SavePurchaseOrderInDto,
    actor: PoActor,
  ): Promise<PurchaseOrderOutDto> {
    const doc = await requireOrder(id);
    assertOwner(doc, actor);
    if (doc.status !== "draft") throw new Error("Only a draft PO can be edited");
    if (String(doc.requestId) !== input.requestId) {
      throw new Error("A PO cannot move to another SPP; make a new PO instead");
    }
    await withTx(async () => {
      const fields = await this.checkedFields(input, id);
      const updated = await PurchaseOrderRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        { $set: fields },
      );
      if (!updated) throw new Error("PO is no longer a draft");
    });
    return this.get(id, actor);
  }

  async remove(id: string, actor: PoActor): Promise<void> {
    const doc = await requireOrder(id);
    assertOwner(doc, actor);
    if (doc.status !== "draft") throw new Error("Only a draft PO can be deleted; cancel it instead");
    const removed = await PurchaseOrderRepo.deleteOne({ _id: doc._id, status: "draft" });
    if (!removed) throw new Error("PO not found");
  }

  /** Send for approval; lines are checked again against the SPPs. */
  async submit(id: string, actor: PoActor): Promise<PurchaseOrderOutDto> {
    const userId = actor.userId;
    const doc = await requireOrder(id);
    assertOwner(doc, actor);
    if (doc.status !== "draft") throw new Error("Only a draft PO can be sent for approval");
    await withTx(async () => {
      await this.checkedFields(
        {
          requestId: String(doc.requestId),
          vendorId: String(doc.vendorId),
          termOfPaymentId: doc.termOfPaymentId ? String(doc.termOfPaymentId) : null,
          expectedDate: doc.expectedDate ?? null,
          notes: doc.notes,
          lines: doc.lines.map((l) => ({
            requestLineId: String(l.requestLineId),
            qty: l.qty,
            unitPrice: l.unitPrice,
            note: l.note,
          })),
        },
        id,
      );
      await this.transition(doc, "draft", {
        status: "pending_approval",
        submittedAt: new Date(),
        submittedBy: new Types.ObjectId(userId),
      });
    });
    return this.get(id, actor);
  }

  async approve(id: string, actor: PoActor): Promise<PurchaseOrderOutDto> {
    const userId = actor.userId;
    const doc = await requireOrder(id);
    if (doc.status !== "pending_approval") throw new Error("Only a PO waiting for approval can be approved");
    await this.transition(doc, "pending_approval", {
      status: "approved",
      approvedAt: new Date(),
      approvedBy: new Types.ObjectId(userId),
      approvedByName: await displayName(userId),
    });
    return this.get(id, actor);
  }

  async reject(id: string, actor: PoActor, reason: string): Promise<PurchaseOrderOutDto> {
    const userId = actor.userId;
    const doc = await requireOrder(id);
    if (doc.status !== "pending_approval") throw new Error("Only a PO waiting for approval can be rejected");
    await this.transition(doc, "pending_approval", {
      status: "rejected",
      rejectedAt: new Date(),
      rejectedBy: new Types.ObjectId(userId),
      rejectReason: reason,
    });
    return this.get(id, actor);
  }

  /** A rejected PO goes back to draft so purchasing can fix and resend it. */
  async revise(id: string, actor: PoActor): Promise<PurchaseOrderOutDto> {
    const doc = await requireOrder(id);
    assertOwner(doc, actor);
    if (doc.status !== "rejected") throw new Error("Only a rejected PO can be revised");
    await this.transition(doc, "rejected", { status: "draft", submittedAt: null, submittedBy: null });
    return this.get(id, actor);
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
    const notas = await PurchaseRealizationRepo.model
      .countDocuments({ purchaseOrderId: doc._id, status: { $ne: "voided" } })
      .exec();
    if (notas > 0) {
      throw new Error("This PO has nota realisasi: void them before cancelling the PO");
    }
    const receipts = await GoodsReceiptRepo.model
      .countDocuments({ purchaseOrderId: doc._id, status: "posted" })
      .exec();
    if (receipts > 0) {
      throw new Error("Goods were already received on this PO: void the receipts before cancelling it");
    }
    await this.transition(doc, doc.status, {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: new Types.ObjectId(userId),
      cancelReason: reason,
    });
    return this.get(id, actor);
  }

  private async transition(
    doc: LeanOrder,
    from: PurchaseOrderStatus,
    set: Record<string, unknown>,
  ): Promise<void> {
    const updated = await PurchaseOrderRepo.findOneAndUpdate(
      { _id: doc._id, status: from },
      { $set: set },
    );
    if (!updated) throw new Error("The PO was changed by someone else; reload it");
  }

  /** Vendor, term and lines checked and shaped for storage. */
  private async checkedFields(input: SavePurchaseOrderInDto, exceptOrderId?: string) {
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
      total: checked.total,
      lines: checked.lines.map((l) => {
        const e = entries.get(l.requestLineId)!;
        return {
          requestId: e.request._id,
          requestLineId: e.line._id,
          projectId: e.request.projectId,
          productionOrderId: e.request.productionOrderId ?? null,
          materialItemId: e.line.materialItemId,
          itemUomId: e.line.itemUomId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          note: l.note,
        };
      }),
    };
  }

  private async summaries(docs: LeanOrder[]): Promise<PurchaseOrderSummaryOutDto[]> {
    if (docs.length === 0) return [];
    const vendorIds = [...new Set(docs.map((d) => String(d.vendorId)))];
    const requestOf = (d: LeanOrder) =>
      String(d.requestId ?? d.lines[0]?.requestId ?? "");
    const projectIds = [...new Set(docs.flatMap((d) => d.lines.map((l) => String(l.projectId))))];
    const requestIds = [...new Set(docs.map(requestOf).filter(Boolean))];
    const [vendors, projects, requests, names, prices] = await Promise.all([
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
        .select({ number: 1, projectId: 1 })
        .lean()
        .exec(),
      userEmailsById(docs.flatMap((d) => (d.createdBy ? [String(d.createdBy)] : []))),
      rabPrices(projectIds),
    ]);
    const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
    const projectById = new Map(projects.map((p) => [String(p._id), p]));
    const requestById = new Map(requests.map((r) => [String(r._id), r]));
    const projectOf = (d: LeanOrder) =>
      String(requestById.get(requestOf(d))?.projectId ?? d.lines[0]?.projectId ?? "");
    return docs.map((d) => {
      const createdBy = d.createdBy ? String(d.createdBy) : null;
      const overBudgetCount = d.lines.filter((l) => {
        const price = prices
          .get(String(l.projectId))
          ?.get(rabLineKey(String(l.materialItemId), String(l.itemUomId)));
        return price !== undefined && new Decimal(l.unitPrice).gt(price);
      }).length;
      return {
        id: String(d._id),
        number: d.number,
        status: d.status,
        vendorId: String(d.vendorId),
        vendorName: vendorName.get(String(d.vendorId)) ?? "Unknown vendor",
        total: d.total,
        lineCount: d.lines.length,
        overBudgetCount,
        requestId: requestOf(d),
        requestNumber: requestById.get(requestOf(d))?.number ?? "—",
        projectNumber: projectById.get(projectOf(d))?.projectNumber ?? "—",
        projectName: projectById.get(projectOf(d))?.name ?? "Unknown project",
        expectedDate: d.expectedDate ?? null,
        createdBy: createdBy ? { id: createdBy, name: names.get(createdBy) ?? createdBy } : null,
        createdAt: iso(d.createdAt),
        submittedAt: iso(d.submittedAt),
        approvedAt: iso(d.approvedAt),
      };
    });
  }
}

export const purchaseOrderService = new PurchaseOrderService();

function rupiah(digits: string): string {
  return `Rp ${new Intl.NumberFormat("id-ID").format(Number(digits))}`;
}

function lineDetails(l: PurchaseOrderLineOutDto): string[] {
  const flags = [
    l.source === "extra" ? "Di luar SPK" : null,
    l.overPlan ? "Melebihi kebutuhan SPK" : null,
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
          ["SPK", spk ? `${spk.productionOrderNumber}${spk.itemLabel ? ` · ${spk.itemLabel}` : ""}` : "-"],
          ["Ref. SPP", order.requestNumber],
          ["Diminta oleh", requesterName || "-"],
          ["Dibutuhkan", ymdLong(request?.neededDate ?? null)],
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
      notes: splitLines(order.notes),
      approvalLink: { url, qrPng },
      signDate: formatLongDate(submittedAt),
      signatures: [
        ["Diajukan oleh,", creatorName || null],
        ["Disetujui oleh,", null],
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
      signatures: [
        ["Dibuat oleh,", creatorName || null],
        ["Disetujui oleh,", approved ? doc.approvedByName || order.approvedBy?.name || null : null],
      ],
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
