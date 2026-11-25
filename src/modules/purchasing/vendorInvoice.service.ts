import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import { deleteFileIfExists, findFile, openDownload, uploadFile } from "../../core/gridfs";
import { logger } from "../../core/logger";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import type {
  SaveVendorInvoiceInDto,
  VendorInvoiceOutDto,
  VendorInvoicePlanOutDto,
  VendorInvoiceQueueRowOutDto,
  VendorInvoiceStatusDto,
  VendorInvoiceSummaryOutDto,
} from "../../dto/purchasing.dto";
import { PurchaseOrderRepo, type PurchaseOrderInterface } from "../../models/purchaseOrder.model";
import { PURCHASE_PAYMENT_LIVE_STATUSES, PurchasePaymentRepo } from "../../models/purchasePayment.model";
import {
  PurchaseRealizationRepo,
  type PurchaseRealizationInterface,
} from "../../models/purchaseRealization.model";
import { PurchasingSeqCounterModel } from "../../models/seqCounter.model";
import { VendorInvoiceRepo, type VendorInvoiceInterface } from "../../models/vendorInvoice.model";
import { userEmailsById } from "../auth";
import { numberingPeriod } from "../../utils/numbering";
import { lineAmount } from "./purchaseOrder.planner";
import { PURCHASING_BUCKET, purchaseOrderService, type PoActor } from "./purchaseOrder.service";
import { checkRealizationCharges, inferChargeCategory } from "../../utils/charges";
import { checkInvoiceLines } from "./vendorInvoice.planner";
import { assertVendorNotOverpaid, invoiceMoneyOf, repriceVendorReceipts } from "./vendorMoney";
import { getVendorNames } from "../vendor";

type LeanInvoice = VendorInvoiceInterface & { _id: Types.ObjectId };
type LeanRealization = PurchaseRealizationInterface & { _id: Types.ObjectId };
type LeanOrder = PurchaseOrderInterface & { _id: Types.ObjectId };

const SOURCE = "modules/purchasing/vendorInvoice.service.ts";
const FILE_MAX = 12;
const FILE_MAX_BYTES = 15 * 1024 * 1024;
const FILE_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const LIVE: VendorInvoiceStatusDto[] = ["draft", "posted"];

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function allocateNumber(): Promise<string> {
  const parts = numberingPeriod();
  const scopeKey = `inv:${parts.scopeKey}`;
  const counter = await PurchasingSeqCounterModel.findOneAndUpdate(
    { scopeKey },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey } },
    { upsert: true, returnDocument: "after" },
  ).exec();
  if (!counter || counter.nextSeq < 1) throw new Error("Failed to allocate invoice number");
  return `INV/${parts.roman}/${parts.year}/${String(counter.nextSeq).padStart(4, "0")}`;
}

async function requireInvoice(id: string): Promise<LeanInvoice> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid invoice id");
  const doc = (await VendorInvoiceRepo.model.findById(id).lean().exec()) as LeanInvoice | null;
  if (!doc) throw new Error("Vendor invoice not found");
  return doc;
}

async function requireOrder(id: string | Types.ObjectId): Promise<LeanOrder> {
  const doc = (await PurchaseOrderRepo.model.findById(id).lean().exec()) as LeanOrder | null;
  if (!doc) throw new Error("PO not found");
  return doc;
}

/** The approved / paid payment naming this invoice (or, from before invoices, its GRs), which locks it. */
async function lockingPayment(doc: Pick<LeanInvoice, "_id" | "realizationIds">) {
  return PurchasePaymentRepo.model
    .findOne({
      status: { $in: ["approved", "paid"] },
      $or: [{ invoiceIds: doc._id }, { realizationIds: { $in: doc.realizationIds } }],
    })
    .select({ number: 1 })
    .lean()
    .exec();
}

async function assertUnlocked(doc: LeanInvoice): Promise<void> {
  const payment = await lockingPayment(doc);
  if (payment) throw new Error(`Payment ${payment.number} is approved for this invoice: cancel it before changing the invoice`);
}

/** The invoice checked against its PO's posted vendor GRs; returns the fields to store. */
async function checkedFields(input: SaveVendorInvoiceInDto, exceptId?: Types.ObjectId) {
  const order = await requireOrder(input.purchaseOrderId);
  if (order.status !== "approved" && !(order.status === "cancelled" && order.closedPartial)) {
    throw new Error("Invoices can only be added to an approved PO");
  }
  const receipts = (await PurchaseRealizationRepo.model
    .find({ _id: { $in: input.realizationIds.map((id) => new Types.ObjectId(id)) } })
    .sort({ postedAt: 1, createdAt: 1 })
    .lean()
    .exec()) as LeanRealization[];
  if (receipts.length !== input.realizationIds.length) throw new Error("A goods receipt was not found");
  for (const r of receipts) {
    if (String(r.purchaseOrderId) !== String(order._id)) throw new Error(`${r.number} is not on this PO`);
    if (r.method !== "vendor") throw new Error(`${r.number} is a staff nota, not a vendor goods receipt`);
    if (r.status !== "posted") throw new Error(`${r.number} is not posted`);
    if (r.invoiceId && (!exceptId || String(r.invoiceId) !== String(exceptId))) {
      throw new Error(`${r.number} is already on another invoice`);
    }
  }
  const checked = checkInvoiceLines({
    receiptLines: receipts.flatMap((r) =>
      r.lines.map((l, i) => ({
        realizationLineId: String(l._id),
        poLineId: String(l.poLineId),
        qty: l.qty,
        label: `${r.number} line ${i + 1}`,
      })),
    ),
    lines: input.lines,
  });
  const receiptOfLine = new Map(receipts.flatMap((r) => r.lines.map((l) => [String(l._id), r._id] as const)));
  const priced = checkRealizationCharges(checked.subtotal, input.charges);
  return {
    order,
    fields: {
      purchaseOrderId: order._id,
      vendorId: order.vendorId,
      vendorInvoiceNumber: input.vendorInvoiceNumber,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      notes: input.notes,
      realizationIds: receipts.map((r) => r._id),
      lines: checked.lines.map((l) => ({
        realizationId: receiptOfLine.get(l.realizationLineId)!,
        realizationLineId: new Types.ObjectId(l.realizationLineId),
        poLineId: new Types.ObjectId(l.poLineId),
        qty: l.qty,
        unitPrice: l.unitPrice,
        note: l.note,
      })),
      charges: priced.charges,
      subtotal: checked.subtotal,
      chargesTotal: priced.chargesTotal,
      total: priced.total,
    },
  };
}

/** Point GRs at the invoice that covers them (draft or posted), clearing the ones it dropped. */
async function syncReceipts(invoiceId: Types.ObjectId, before: Types.ObjectId[], after: Types.ObjectId[]): Promise<void> {
  const keep = new Set(after.map(String));
  for (const id of before) {
    if (!keep.has(String(id))) {
      await PurchaseRealizationRepo.findOneAndUpdate({ _id: id, invoiceId }, { $set: { invoiceId: null } });
    }
  }
  for (const id of after) {
    await PurchaseRealizationRepo.findOneAndUpdate({ _id: id }, { $set: { invoiceId } });
  }
}

export class VendorInvoiceService {
  /** POs with posted vendor GRs that no live invoice covers yet. */
  async queue(): Promise<VendorInvoiceQueueRowOutDto[]> {
    const receipts = (await PurchaseRealizationRepo.model
      .find({ method: "vendor", status: "posted", invoiceId: null })
      .sort({ postedAt: 1 })
      .limit(1000)
      .lean()
      .exec()) as LeanRealization[];
    if (receipts.length === 0) return [];
    const orderIds = [...new Set(receipts.map((r) => String(r.purchaseOrderId)))];
    const summaries = new Map((await purchaseOrderService.list({ ids: orderIds })).map((s) => [s.id, s]));
    return orderIds.map((id) => ({
      purchaseOrderId: id,
      poNumber: summaries.get(id)?.number ?? "—",
      vendorName: summaries.get(id)?.vendorName ?? "—",
      receipts: receipts
        .filter((r) => String(r.purchaseOrderId) === id)
        .map((r) => ({
          id: String(r._id),
          number: r.number,
          purchaseDate: r.purchaseDate,
          deliveryNoteNumber: r.deliveryNoteNumber ?? "",
          total: r.total,
        })),
    }));
  }

  /** What may go on an invoice for a PO (plus the GRs of `exceptId` when editing it). */
  async plan(orderId: string, exceptId?: string): Promise<VendorInvoicePlanOutDto> {
    const order = await purchaseOrderService.get(orderId);
    const except = exceptId && Types.ObjectId.isValid(exceptId) ? new Types.ObjectId(exceptId) : null;
    const receipts = (await PurchaseRealizationRepo.model
      .find({
        purchaseOrderId: new Types.ObjectId(orderId),
        method: "vendor",
        status: "posted",
        invoiceId: { $in: except ? [null, except] : [null] },
      })
      .sort({ postedAt: 1, createdAt: 1 })
      .lean()
      .exec()) as LeanRealization[];
    const poLine = new Map(order.lines.map((l) => [l.id, l]));
    return {
      purchaseOrderId: order.id,
      poNumber: order.number,
      vendorName: order.vendorName,
      estimatedCharges: order.estimatedCharges,
      receipts: receipts.map((r) => ({
        id: String(r._id),
        number: r.number,
        purchaseDate: r.purchaseDate,
        deliveryNoteNumber: r.deliveryNoteNumber ?? "",
        lines: r.lines.map((l) => {
          const po = poLine.get(String(l.poLineId));
          return {
            realizationLineId: String(l._id),
            poLineId: String(l.poLineId),
            materialCode: po?.materialCode ?? "—",
            materialName: po?.materialName ?? "Unknown",
            uomSymbol: po?.uomSymbol ?? "—",
            qty: l.qty,
            poPrice: po?.unitPrice ?? "0",
          };
        }),
      })),
    };
  }

  async list(filter: {
    status?: VendorInvoiceStatusDto;
    purchaseOrderId?: string;
    q?: string;
  }): Promise<VendorInvoiceSummaryOutDto[]> {
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    if (filter.purchaseOrderId) query.purchaseOrderId = new Types.ObjectId(filter.purchaseOrderId);
    const docs = (await VendorInvoiceRepo.model.find(query).sort({ createdAt: -1 }).limit(500).lean().exec()) as LeanInvoice[];
    const rows = await this.summaries(docs);
    const q = filter.q?.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.vendorInvoiceNumber, r.poNumber, r.vendorName, ...r.receipts.flatMap((g) => [g.number, g.deliveryNoteNumber])].some(
        (v) => v.toLowerCase().includes(q),
      ),
    );
  }

  async get(id: string): Promise<VendorInvoiceOutDto> {
    const doc = await requireInvoice(id);
    const [summary] = await this.summaries([doc]);
    const order = await purchaseOrderService.get(String(doc.purchaseOrderId));
    const poLine = new Map(order.lines.map((l) => [l.id, l]));
    const receiptNumber = new Map(summary!.receipts.map((r) => [r.id, r.number]));
    const names = await userEmailsById(
      [doc.postedBy, doc.voidedBy, ...doc.files.map((f) => f.uploadedBy)].filter(Boolean).map(String),
    );
    const ref = (oid: Types.ObjectId | null | undefined): ProjectRabUserRefOutDto | null =>
      oid ? { id: String(oid), name: names.get(String(oid)) ?? String(oid) } : null;
    const [lock, siblings, payments] = await Promise.all([
      doc.status === "voided" ? Promise.resolve(null) : lockingPayment(doc),
      doc.vendorInvoiceNumber
        ? VendorInvoiceRepo.model
            .find({
              _id: { $ne: doc._id },
              vendorId: doc.vendorId,
              vendorInvoiceNumber: doc.vendorInvoiceNumber,
              status: { $in: LIVE },
            })
            .lean()
            .exec()
        : Promise.resolve([]),
      PurchasePaymentRepo.model
        .find({ invoiceIds: doc._id, status: { $in: PURCHASE_PAYMENT_LIVE_STATUSES } })
        .select({ number: 1, status: 1, amount: 1 })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
    ]);
    const siblingPos = await PurchaseOrderRepo.model
      .find({ _id: { $in: siblings.map((s) => s.purchaseOrderId) } })
      .select({ number: 1 })
      .lean()
      .exec();
    const poNumber = new Map(siblingPos.map((p) => [String(p._id), p.number]));
    return {
      ...summary!,
      lines: doc.lines.map((l) => {
        const po = poLine.get(String(l.poLineId));
        const amount = lineAmount(l.qty, l.unitPrice);
        const poPrice = po?.unitPrice ?? l.unitPrice;
        return {
          id: String(l._id),
          realizationId: String(l.realizationId),
          realizationNumber: receiptNumber.get(String(l.realizationId)) ?? "—",
          realizationLineId: String(l.realizationLineId),
          poLineId: String(l.poLineId),
          materialCode: po?.materialCode ?? "—",
          materialName: po?.materialName ?? "Unknown",
          uomSymbol: po?.uomSymbol ?? "—",
          qty: l.qty,
          unitPrice: l.unitPrice,
          poPrice,
          amount: amount.toFixed(0),
          difference: amount.minus(lineAmount(l.qty, poPrice)).toFixed(0),
          note: l.note ?? "",
        };
      }),
      charges: doc.charges.map((c) => ({
        id: String(c._id),
        category: c.category ?? inferChargeCategory(c.label),
        label: c.label,
        kind: c.kind,
        rate: c.rate ?? null,
        amount: c.amount,
      })),
      files: doc.files.map((f) => ({
        id: String(f._id),
        originalFilename: f.originalFilename,
        contentType: f.contentType,
        sizeBytes: f.sizeBytes,
        uploadedBy: ref(f.uploadedBy),
        uploadedAt: iso(f.uploadedAt),
      })),
      notes: doc.notes ?? "",
      postedBy: ref(doc.postedBy),
      voidedAt: iso(doc.voidedAt),
      voidedBy: ref(doc.voidedBy),
      voidReason: doc.voidReason ?? "",
      lockedBy: lock ? { id: String(lock._id), number: lock.number } : null,
      payments: payments.map((p) => ({ id: String(p._id), number: p.number, status: p.status, amount: p.amount })),
      sameNumber: siblings.map((s) => ({
        id: String(s._id),
        number: s.number,
        poNumber: poNumber.get(String(s.purchaseOrderId)) ?? "—",
        total: s.total,
        status: s.status,
      })),
    };
  }

  async create(input: SaveVendorInvoiceInDto, actor: PoActor): Promise<VendorInvoiceOutDto> {
    const created = await withTx(async () => {
      const { fields } = await checkedFields(input);
      const doc = await VendorInvoiceRepo.create({
        ...fields,
        number: await allocateNumber(),
        status: "draft",
        files: [],
        createdBy: new Types.ObjectId(actor.userId),
      });
      await syncReceipts(doc._id, [], fields.realizationIds);
      return doc;
    });
    return this.get(String(created._id));
  }

  /** A draft, or a posted invoice no approved payment holds yet (re-prices its GRs). */
  async update(id: string, input: SaveVendorInvoiceInDto): Promise<VendorInvoiceOutDto> {
    const doc = await requireInvoice(id);
    if (doc.status === "voided") throw new Error("A voided invoice cannot be changed");
    if (String(doc.purchaseOrderId) !== input.purchaseOrderId) throw new Error("An invoice cannot move to another PO");
    if (doc.status === "posted") await assertUnlocked(doc);
    await withTx(async () => {
      const { order, fields } = await checkedFields(input, doc._id);
      if (doc.status === "posted") {
        await assertVendorNotOverpaid(order, { invoice: { id, next: invoiceMoneyOf({ ...fields, _id: doc._id }) } });
      }
      const updated = await VendorInvoiceRepo.findOneAndUpdate({ _id: doc._id, status: doc.status }, { $set: fields });
      if (!updated) throw new Error("Invoice changed meanwhile; reload it");
      await syncReceipts(doc._id, doc.realizationIds, fields.realizationIds);
    });
    if (doc.status === "posted") await repriceVendorReceipts(doc.purchaseOrderId);
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const doc = await requireInvoice(id);
    if (doc.status !== "draft") throw new Error("Only a draft can be deleted; void it instead");
    await withTx(async () => {
      const removed = await VendorInvoiceRepo.deleteOne({ _id: doc._id, status: "draft" });
      if (!removed) throw new Error("Vendor invoice not found");
      await syncReceipts(doc._id, doc.realizationIds, []);
    });
    for (const f of doc.files) {
      await deleteFileIfExists(PURCHASING_BUCKET, f.gridFsId).catch((error: unknown) =>
        logger.warn(error instanceof Error ? error.message : String(error), SOURCE, "remove"),
      );
    }
  }

  /** The invoice now prices its GRs. */
  async post(id: string, actor: PoActor): Promise<VendorInvoiceOutDto> {
    const doc = await requireInvoice(id);
    if (doc.status !== "draft") throw new Error("Only a draft invoice can be posted");
    await withTx(async () => {
      const { order } = await checkedFields(this.inputOf(doc), doc._id);
      await assertVendorNotOverpaid(order, { invoice: { id, next: invoiceMoneyOf(doc) } });
      const updated = await VendorInvoiceRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        { $set: { status: "posted", postedAt: new Date(), postedBy: new Types.ObjectId(actor.userId) } },
      );
      if (!updated) throw new Error("Invoice is no longer a draft");
    });
    await repriceVendorReceipts(doc.purchaseOrderId);
    return this.get(id);
  }

  /** Its GRs go back to the PO price and may be invoiced again. */
  async void(id: string, reason: string, actor: PoActor): Promise<VendorInvoiceOutDto> {
    const doc = await requireInvoice(id);
    if (doc.status !== "posted") throw new Error("Only a posted invoice can be voided");
    await assertUnlocked(doc);
    const naming = await PurchasePaymentRepo.model
      .findOne({ invoiceIds: doc._id, status: { $in: PURCHASE_PAYMENT_LIVE_STATUSES } })
      .select({ number: 1 })
      .lean()
      .exec();
    if (naming) throw new Error(`Payment ${naming.number} names this invoice: remove it there (or cancel the payment) first`);
    await withTx(async () => {
      await assertVendorNotOverpaid(await requireOrder(doc.purchaseOrderId), { invoice: { id, next: null } });
      const updated = await VendorInvoiceRepo.findOneAndUpdate(
        { _id: doc._id, status: "posted" },
        {
          $set: {
            status: "voided",
            voidedAt: new Date(),
            voidedBy: new Types.ObjectId(actor.userId),
            voidReason: reason,
          },
        },
      );
      if (!updated) throw new Error("Invoice changed meanwhile; reload it");
      await syncReceipts(doc._id, doc.realizationIds, []);
    });
    await repriceVendorReceipts(doc.purchaseOrderId);
    return this.get(id);
  }

  async addFiles(id: string, files: Express.Multer.File[], actor: PoActor): Promise<VendorInvoiceOutDto> {
    const doc = await requireInvoice(id);
    if (doc.status === "voided") throw new Error("A voided invoice cannot be changed");
    if (files.length === 0) throw new Error("Choose at least one file");
    if (doc.files.length + files.length > FILE_MAX) throw new Error(`At most ${FILE_MAX} files per invoice`);
    for (const f of files) {
      if (!FILE_TYPES.test(f.mimetype)) throw new Error(`${f.originalname}: use a photo (JPG, PNG, WEBP, HEIC) or a PDF`);
      if (f.size > FILE_MAX_BYTES) throw new Error(`${f.originalname} is larger than 15 MB`);
    }
    const uploaded: VendorInvoiceInterface["files"] = [];
    try {
      for (const f of files) {
        const stored = await uploadFile(PURCHASING_BUCKET, {
          buffer: f.buffer,
          filename: f.originalname,
          contentType: f.mimetype,
          metadata: { vendorInvoiceId: id },
        });
        uploaded.push({
          gridFsId: stored.id,
          originalFilename: f.originalname,
          contentType: f.mimetype,
          sizeBytes: f.size,
          uploadedBy: new Types.ObjectId(actor.userId),
          uploadedAt: new Date(),
        });
      }
      const updated = await VendorInvoiceRepo.findOneAndUpdate(
        { _id: doc._id, status: { $in: LIVE } },
        { $push: { files: { $each: uploaded } } },
      );
      if (!updated) throw new Error("Invoice was voided meanwhile");
    } catch (error) {
      for (const f of uploaded) await deleteFileIfExists(PURCHASING_BUCKET, f.gridFsId);
      throw error;
    }
    return this.get(id);
  }

  async removeFile(id: string, fileId: string): Promise<VendorInvoiceOutDto> {
    const doc = await requireInvoice(id);
    if (doc.status === "voided") throw new Error("A voided invoice cannot be changed");
    const file = doc.files.find((f) => String(f._id) === fileId);
    if (!file) throw new Error("File not found");
    await VendorInvoiceRepo.findOneAndUpdate({ _id: doc._id }, { $pull: { files: { _id: file._id } } });
    await deleteFileIfExists(PURCHASING_BUCKET, file.gridFsId).catch((error: unknown) =>
      logger.warn(error instanceof Error ? error.message : String(error), SOURCE, "removeFile"),
    );
    return this.get(id);
  }

  async openFile(id: string, fileId: string) {
    const doc = await requireInvoice(id);
    const file = doc.files.find((f) => String(f._id) === fileId);
    if (!file) throw new Error("File not found");
    if (!(await findFile(PURCHASING_BUCKET, file.gridFsId))) throw new Error("File not found");
    return {
      stream: openDownload(PURCHASING_BUCKET, file.gridFsId),
      filename: file.originalFilename,
      contentType: file.contentType,
    };
  }

  /** Live invoices of a PO, for the PO page. */
  async forOrder(orderId: string): Promise<VendorInvoiceSummaryOutDto[]> {
    if (!Types.ObjectId.isValid(orderId)) throw new Error("Invalid PO id");
    return this.list({ purchaseOrderId: orderId });
  }

  private inputOf(doc: LeanInvoice): SaveVendorInvoiceInDto {
    return {
      purchaseOrderId: String(doc.purchaseOrderId),
      vendorInvoiceNumber: doc.vendorInvoiceNumber,
      invoiceDate: doc.invoiceDate,
      dueDate: doc.dueDate ?? null,
      notes: doc.notes,
      realizationIds: doc.realizationIds.map(String),
      lines: doc.lines.map((l) => ({ realizationLineId: String(l.realizationLineId), unitPrice: l.unitPrice, note: l.note })),
      charges: doc.charges.map((c) => ({
        category: c.category ?? inferChargeCategory(c.label),
        label: c.label,
        kind: c.kind,
        rate: c.rate ?? null,
        amount: c.amount,
      })),
    };
  }

  private async summaries(docs: LeanInvoice[]): Promise<VendorInvoiceSummaryOutDto[]> {
    if (docs.length === 0) return [];
    const [orders, vendorName, receipts] = await Promise.all([
      PurchaseOrderRepo.model
        .find({ _id: { $in: docs.map((d) => d.purchaseOrderId) } })
        .select({ number: 1 })
        .lean()
        .exec(),
      getVendorNames(docs.map((d) => d.vendorId)),
      PurchaseRealizationRepo.model
        .find({ _id: { $in: docs.flatMap((d) => d.realizationIds) } })
        .select({ number: 1, purchaseDate: 1, deliveryNoteNumber: 1 })
        .lean()
        .exec(),
    ]);
    const poNumber = new Map(orders.map((o) => [String(o._id), o.number]));
    const receiptById = new Map(receipts.map((r) => [String(r._id), r]));
    const names = await userEmailsById(docs.flatMap((d) => (d.createdBy ? [String(d.createdBy)] : [])));
    return docs.map((d) => {
      const createdBy = d.createdBy ? String(d.createdBy) : null;
      return {
        id: String(d._id),
        number: d.number,
        status: d.status,
        purchaseOrderId: String(d.purchaseOrderId),
        poNumber: poNumber.get(String(d.purchaseOrderId)) ?? "—",
        vendorName: vendorName.get(String(d.vendorId)) ?? "Unknown vendor",
        vendorInvoiceNumber: d.vendorInvoiceNumber ?? "",
        invoiceDate: d.invoiceDate,
        dueDate: d.dueDate ?? null,
        receipts: d.realizationIds.map((rid) => {
          const r = receiptById.get(String(rid));
          return {
            id: String(rid),
            number: r?.number ?? "—",
            purchaseDate: r?.purchaseDate ?? "",
            deliveryNoteNumber: r?.deliveryNoteNumber ?? "",
          };
        }),
        subtotal: d.subtotal,
        chargesTotal: d.chargesTotal,
        total: d.total,
        fileCount: d.files.length,
        createdBy: createdBy ? { id: createdBy, name: names.get(createdBy) ?? createdBy } : null,
        createdAt: iso(d.createdAt),
        postedAt: iso(d.postedAt),
      };
    });
  }
}

export const vendorInvoiceService = new VendorInvoiceService();
