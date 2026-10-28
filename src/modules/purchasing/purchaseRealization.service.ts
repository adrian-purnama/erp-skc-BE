import Decimal from "decimal.js";
import { Types } from "mongoose";
import { deleteFileIfExists, findFile, openDownload, uploadFile } from "../../buckets/gridfs";
import { withTx } from "../../core/audit/context";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import type {
  PurchaseRealizationStatusDto,
  PurchasingUserOutDto,
  RealizationLineOutDto,
  RealizationOutDto,
  RealizationPlanOutDto,
  RealizationQueueRowOutDto,
  RealizationSummaryOutDto,
  SaveRealizationInDto,
} from "../../dto/purchasing.dto";
import { logger } from "../../logger/logger";
import { PurchaseOrderRepo } from "../../models/purchaseOrder/purchaseOrder.model";
import {
  PurchaseRealizationRepo,
  type PurchaseRealizationInterface,
} from "../../models/purchaseRealization/purchaseRealization.model";
import { PurchasingSeqCounterModel } from "../../models/seqCounter/seqCounter.model";
import { UserModel } from "../../models/user/user.model";
import { userEmailsById } from "../../utils/shared";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { projectNumberParts } from "../project/projectNumber";
import { lineAmount } from "./purchaseOrder.planner";
import { purchaseOrderService, type PoActor } from "./purchaseOrder.service";
import {
  checkRealizationCharges,
  checkRealizationLines,
  realizationStatus,
  remainingToRealize,
  sumRealized,
  type PoLineRef,
} from "./purchaseRealization.planner";

/** Nota files live apart from project files (Shrink DB only cleans `project`). */
export const PURCHASING_BUCKET = "purchasing";
const PHOTO_MAX = 12;
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const PHOTO_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

type LeanRealization = PurchaseRealizationInterface & { _id: Types.ObjectId };

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function allocateNumber(): Promise<string> {
  const parts = projectNumberParts();
  const scopeKey = `nr:${parts.scopeKey}`;
  const counter = await PurchasingSeqCounterModel.findOneAndUpdate(
    { scopeKey },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey } },
    { upsert: true, new: true },
  ).exec();
  if (!counter || counter.nextSeq < 1) throw new Error("Failed to allocate nota number");
  return `NR/${parts.roman}/${parts.year}/${String(counter.nextSeq).padStart(4, "0")}`;
}

async function requireRealization(id: string): Promise<LeanRealization> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid realization id");
  const doc = (await PurchaseRealizationRepo.model.findById(id).lean().exec()) as LeanRealization | null;
  if (!doc) throw new Error("Realization not found");
  return doc;
}

function isOwner(doc: LeanRealization, actor: PoActor): boolean {
  return actor.superAdmin || String(doc.createdBy) === actor.userId;
}

function assertDraftOwner(doc: LeanRealization, actor: PoActor): void {
  if (!isOwner(doc, actor)) throw new Error("Only the person who recorded this realization can change it");
  if (doc.status !== "draft") throw new Error("Only a draft realization can be changed");
}

async function userName(userId: string): Promise<string> {
  const user = await UserModel.findById(userId)
    .select({ fullName: 1, email: 1, isBlocked: 1 })
    .lean()
    .exec();
  if (!user) throw new Error("User not found");
  return user.fullName?.trim() || user.email || "";
}

/** Qty per PO line held by live (draft / posted) notas, optionally leaving one out. */
async function realizedOnOrder(orderId: string, exceptId?: string): Promise<Map<string, Decimal>> {
  const query: Record<string, unknown> = {
    purchaseOrderId: new Types.ObjectId(orderId),
    status: { $in: ["draft", "posted"] },
  };
  if (exceptId) query._id = { $ne: new Types.ObjectId(exceptId) };
  const docs = await PurchaseRealizationRepo.model.find(query).select({ lines: 1 }).lean().exec();
  return sumRealized(
    docs.flatMap((d) => d.lines.map((l) => ({ poLineId: String(l.poLineId), qty: l.qty }))),
  );
}

export class PurchaseRealizationService {
  /** Active users who can be named as the buyer. */
  async buyers(): Promise<PurchasingUserOutDto[]> {
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

  /** Approved POs not fully realized yet, oldest approval first. */
  async queue(): Promise<RealizationQueueRowOutDto[]> {
    const orders = await PurchaseOrderRepo.model
      .find({ status: "approved" })
      .sort({ approvedAt: 1 })
      .limit(500)
      .lean()
      .exec();
    if (orders.length === 0) return [];
    const notas = await PurchaseRealizationRepo.model
      .find({ purchaseOrderId: { $in: orders.map((o) => o._id) }, status: "posted" })
      .select({ purchaseOrderId: 1, lines: 1, total: 1 })
      .lean()
      .exec();
    const summaries = await purchaseOrderService.list({ status: "approved" });
    const summaryById = new Map(summaries.map((s) => [s.id, s]));
    const rows: RealizationQueueRowOutDto[] = [];
    for (const o of orders) {
      const mine = notas.filter((n) => String(n.purchaseOrderId) === String(o._id));
      const realized = sumRealized(
        mine.flatMap((n) => n.lines.map((l) => ({ poLineId: String(l.poLineId), qty: l.qty }))),
      );
      const status = realizationStatus(
        o.lines.map((l) => ({ qty: l.qty, realized: realized.get(String(l._id)) })),
      );
      const summary = summaryById.get(String(o._id));
      if (status === "full" || !summary) continue;
      rows.push({
        ...summary,
        realizationStatus: status,
        realizedTotal: mine.reduce((sum, n) => sum.plus(n.total), new Decimal(0)).toFixed(0),
      });
    }
    return rows;
  }

  /** PO lines with what is left to realize. */
  async plan(orderId: string, exceptId?: string): Promise<RealizationPlanOutDto> {
    const order = await purchaseOrderService.get(orderId);
    if (order.status !== "approved") throw new Error("Only an approved PO can be realized");
    const realized = await realizedOnOrder(orderId, exceptId);
    return {
      purchaseOrderId: order.id,
      poNumber: order.number,
      vendorName: order.vendorName,
      requestId: order.requestId,
      requestNumber: order.requestNumber,
      projectNumber: order.projectNumber,
      projectName: order.projectName,
      approvedTotal: order.total,
      lines: order.lines.map((l) => {
        const done = realized.get(l.id) ?? new Decimal(0);
        return {
          poLineId: l.id,
          materialCode: l.materialCode,
          materialName: l.materialName,
          uomSymbol: l.uomSymbol,
          orderedQty: l.qty,
          approvedPrice: l.unitPrice,
          realizedQty: formatDecimal(done),
          remainingQty: formatDecimal(remainingToRealize(l.qty, done)),
        };
      }),
    };
  }

  async list(filter: {
    status?: PurchaseRealizationStatusDto;
    purchaseOrderId?: string;
    q?: string;
  }): Promise<RealizationSummaryOutDto[]> {
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    if (filter.purchaseOrderId) query.purchaseOrderId = new Types.ObjectId(filter.purchaseOrderId);
    const docs = (await PurchaseRealizationRepo.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec()) as LeanRealization[];
    const rows = await this.summaries(docs);
    const q = filter.q?.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.number,
        r.poNumber,
        r.vendorName,
        r.requestNumber,
        r.projectNumber,
        r.buyerName,
        r.receivedByName,
        r.place,
        r.deliveryNoteNumber,
      ].some(
        (v) => v.toLowerCase().includes(q),
      ),
    );
  }

  async get(id: string, actor?: PoActor): Promise<RealizationOutDto> {
    const doc = await requireRealization(id);
    const [summary] = await this.summaries([doc]);
    const order = await purchaseOrderService.get(String(doc.purchaseOrderId));
    const poLine = new Map(order.lines.map((l) => [l.id, l]));
    const names = await userEmailsById(
      [doc.postedBy, doc.voidedBy, ...doc.photos.map((p) => p.uploadedBy)].filter(Boolean).map(String),
    );
    const ref = (oid: Types.ObjectId | null | undefined): ProjectRabUserRefOutDto | null =>
      oid ? { id: String(oid), name: names.get(String(oid)) ?? String(oid) } : null;
    return {
      ...summary!,
      buyerUserId: doc.buyerUserId ? String(doc.buyerUserId) : null,
      receivedByUserId: doc.receivedByUserId ? String(doc.receivedByUserId) : null,
      notaNumber: doc.notaNumber ?? "",
      comments: doc.comments ?? "",
      lines: doc.lines.map((l): RealizationLineOutDto => {
        const po = poLine.get(String(l.poLineId));
        const approved = po?.unitPrice ?? l.unitPrice;
        const amount = lineAmount(l.qty, l.unitPrice);
        return {
          id: String(l._id),
          poLineId: String(l.poLineId),
          materialCode: po?.materialCode ?? "—",
          materialName: po?.materialName ?? "Unknown",
          uomSymbol: po?.uomSymbol ?? "—",
          qty: l.qty,
          unitPrice: l.unitPrice,
          approvedPrice: approved,
          amount: amount.toFixed(0),
          difference: amount.minus(lineAmount(l.qty, approved)).toFixed(0),
          note: l.note ?? "",
        };
      }),
      charges: (doc.charges ?? []).map((c) => ({
        id: String(c._id),
        label: c.label,
        kind: c.kind,
        rate: c.rate ?? null,
        amount: c.amount,
      })),
      photos: doc.photos.map((p) => ({
        id: String(p._id),
        originalFilename: p.originalFilename,
        contentType: p.contentType,
        sizeBytes: p.sizeBytes,
        uploadedBy: ref(p.uploadedBy),
        uploadedAt: iso(p.uploadedAt),
      })),
      postedBy: ref(doc.postedBy),
      voidedAt: iso(doc.voidedAt),
      voidedBy: ref(doc.voidedBy),
      voidReason: doc.voidReason ?? "",
      canChange: actor ? isOwner(doc, actor) : false,
    };
  }

  async create(input: SaveRealizationInDto, actor: PoActor): Promise<RealizationOutDto> {
    const created = await withTx(async () => {
      const fields = await this.checkedFields(input);
      return PurchaseRealizationRepo.create({
        ...fields,
        number: await allocateNumber(),
        status: "draft",
        photos: [],
        createdBy: new Types.ObjectId(actor.userId),
      });
    });
    return this.get(String(created._id), actor);
  }

  async update(id: string, input: SaveRealizationInDto, actor: PoActor): Promise<RealizationOutDto> {
    const doc = await requireRealization(id);
    assertDraftOwner(doc, actor);
    if (String(doc.purchaseOrderId) !== input.purchaseOrderId) {
      throw new Error("A realization cannot move to another PO");
    }
    await withTx(async () => {
      const fields = await this.checkedFields(input, id);
      const updated = await PurchaseRealizationRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        { $set: fields },
      );
      if (!updated) throw new Error("Realization is no longer a draft");
    });
    return this.get(id, actor);
  }

  async remove(id: string, actor: PoActor): Promise<void> {
    const doc = await requireRealization(id);
    assertDraftOwner(doc, actor);
    const removed = await PurchaseRealizationRepo.deleteOne({ _id: doc._id, status: "draft" });
    if (!removed) throw new Error("Realization not found");
    for (const p of doc.photos) {
      await deleteFileIfExists(PURCHASING_BUCKET, p.gridFsId).catch((error: unknown) =>
        logger.warn(
          error instanceof Error ? error.message : String(error),
          "modules/purchasing/purchaseRealization.service.ts",
          "remove",
        ),
      );
    }
  }

  async addPhotos(id: string, files: Express.Multer.File[], actor: PoActor): Promise<RealizationOutDto> {
    const doc = await requireRealization(id);
    assertDraftOwner(doc, actor);
    if (files.length === 0) throw new Error("Choose at least one file");
    if (doc.photos.length + files.length > PHOTO_MAX) {
      throw new Error(`At most ${PHOTO_MAX} files per realization`);
    }
    for (const f of files) {
      if (!PHOTO_TYPES.test(f.mimetype)) {
        throw new Error(`${f.originalname}: use a photo (JPG, PNG, WEBP, HEIC) or a PDF`);
      }
      if (f.size > PHOTO_MAX_BYTES) throw new Error(`${f.originalname} is larger than 15 MB`);
    }
    const uploaded: Array<PurchaseRealizationInterface["photos"][number]> = [];
    try {
      for (const f of files) {
        const stored = await uploadFile(PURCHASING_BUCKET, {
          buffer: f.buffer,
          filename: f.originalname,
          contentType: f.mimetype,
          metadata: { realizationId: id },
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
      const updated = await PurchaseRealizationRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        { $push: { photos: { $each: uploaded } } },
      );
      if (!updated) throw new Error("Realization is no longer a draft");
    } catch (error) {
      for (const p of uploaded) await deleteFileIfExists(PURCHASING_BUCKET, p.gridFsId);
      throw error;
    }
    return this.get(id, actor);
  }

  async removePhoto(id: string, photoId: string, actor: PoActor): Promise<RealizationOutDto> {
    const doc = await requireRealization(id);
    assertDraftOwner(doc, actor);
    const photo = doc.photos.find((p) => String(p._id) === photoId);
    if (!photo) throw new Error("File not found");
    await PurchaseRealizationRepo.findOneAndUpdate(
      { _id: doc._id, status: "draft" },
      { $pull: { photos: { _id: photo._id } } },
    );
    await deleteFileIfExists(PURCHASING_BUCKET, photo.gridFsId);
    return this.get(id, actor);
  }

  async openPhoto(id: string, photoId: string) {
    const doc = await requireRealization(id);
    const photo = doc.photos.find((p) => String(p._id) === photoId);
    if (!photo) throw new Error("File not found");
    if (!(await findFile(PURCHASING_BUCKET, photo.gridFsId))) throw new Error("File not found");
    return {
      stream: openDownload(PURCHASING_BUCKET, photo.gridFsId),
      filename: photo.originalFilename,
      contentType: photo.contentType,
    };
  }

  /** Lock the nota in as the actual purchase; needs at least one nota file. */
  async post(id: string, actor: PoActor): Promise<RealizationOutDto> {
    const doc = await requireRealization(id);
    assertDraftOwner(doc, actor);
    if (doc.photos.length === 0) {
      throw new Error("Add at least one file (nota, invoice, surat jalan or photo) before posting");
    }
    await withTx(async () => {
      await this.checkedFields(
        {
          purchaseOrderId: String(doc.purchaseOrderId),
          method: doc.method,
          buyerUserId: doc.buyerUserId ? String(doc.buyerUserId) : null,
          purchaseDate: doc.purchaseDate,
          place: doc.place,
          notaNumber: doc.notaNumber,
          receivedByUserId: doc.receivedByUserId ? String(doc.receivedByUserId) : null,
          deliveryNoteNumber: doc.deliveryNoteNumber ?? "",
          comments: doc.comments,
          lines: doc.lines.map((l) => ({
            poLineId: String(l.poLineId),
            qty: l.qty,
            unitPrice: l.unitPrice,
            note: l.note,
          })),
          charges: (doc.charges ?? []).map((c) => ({
            label: c.label,
            kind: c.kind,
            rate: c.rate ?? null,
            amount: c.amount,
          })),
        },
        id,
      );
      const updated = await PurchaseRealizationRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        { $set: { status: "posted", postedAt: new Date(), postedBy: new Types.ObjectId(actor.userId) } },
      );
      if (!updated) throw new Error("Realization is no longer a draft");
    });
    return this.get(id, actor);
  }

  async void(id: string, reason: string, actor: PoActor): Promise<RealizationOutDto> {
    const doc = await requireRealization(id);
    if (doc.status !== "posted") throw new Error("Only a posted realization can be voided");
    const updated = await PurchaseRealizationRepo.findOneAndUpdate(
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
    if (!updated) throw new Error("Failed to void realization");
    return this.get(id, actor);
  }

  private async checkedFields(input: SaveRealizationInDto, exceptId?: string) {
    const order = await purchaseOrderService.get(input.purchaseOrderId);
    if (order.status !== "approved") throw new Error("Only an approved PO can be realized");
    const [buyerName, receivedByName] = await Promise.all([
      input.buyerUserId ? userName(input.buyerUserId) : Promise.resolve(""),
      input.receivedByUserId ? userName(input.receivedByUserId) : Promise.resolve(""),
    ]);
    const requestLineOf = new Map(order.lines.map((l) => [l.id, l.requestLineId]));
    const poLines = new Map<string, PoLineRef>(
      order.lines.map((l) => [
        l.id,
        { poLineId: l.id, label: l.materialName, qty: l.qty, unitPrice: l.unitPrice },
      ]),
    );
    const checked = checkRealizationLines({
      lines: input.lines,
      poLines,
      realizedElsewhere: await realizedOnOrder(input.purchaseOrderId, exceptId),
    });
    const priced = checkRealizationCharges(checked.total, input.charges);
    return {
      purchaseOrderId: new Types.ObjectId(order.id),
      requestId: new Types.ObjectId(order.requestId),
      method: input.method,
      buyerUserId: input.buyerUserId ? new Types.ObjectId(input.buyerUserId) : null,
      buyerName,
      purchaseDate: input.purchaseDate,
      place: input.place,
      notaNumber: input.notaNumber,
      receivedByUserId: input.receivedByUserId ? new Types.ObjectId(input.receivedByUserId) : null,
      receivedByName,
      deliveryNoteNumber: input.deliveryNoteNumber,
      comments: input.comments,
      subtotal: checked.total,
      chargesTotal: priced.chargesTotal,
      total: priced.total,
      charges: priced.charges,
      lines: checked.lines.map((l) => ({
        poLineId: new Types.ObjectId(l.poLineId),
        requestLineId: new Types.ObjectId(requestLineOf.get(l.poLineId)!),
        qty: l.qty,
        unitPrice: l.unitPrice,
        note: l.note,
      })),
    };
  }

  private async summaries(docs: LeanRealization[]): Promise<RealizationSummaryOutDto[]> {
    if (docs.length === 0) return [];
    const orderIds = [...new Set(docs.map((d) => String(d.purchaseOrderId)))];
    const orders = await PurchaseOrderRepo.model
      .find({ _id: { $in: orderIds.map((id) => new Types.ObjectId(id)) } })
      .lean()
      .exec();
    const summaries = new Map(
      (await purchaseOrderService.list({ ids: orderIds })).map((s) => [s.id, s]),
    );
    const orderById = new Map(orders.map((o) => [String(o._id), o]));
    const names = await userEmailsById(docs.flatMap((d) => (d.createdBy ? [String(d.createdBy)] : [])));
    return docs.map((d) => {
      const order = orderById.get(String(d.purchaseOrderId));
      const po = summaries.get(String(d.purchaseOrderId));
      const approved = new Map((order?.lines ?? []).map((l) => [String(l._id), l.unitPrice]));
      const difference = d.lines.reduce(
        (sum, l) =>
          sum
            .plus(lineAmount(l.qty, l.unitPrice))
            .minus(lineAmount(l.qty, approved.get(String(l.poLineId)) ?? l.unitPrice)),
        new Decimal(0),
      );
      const createdBy = d.createdBy ? String(d.createdBy) : null;
      return {
        id: String(d._id),
        number: d.number,
        status: d.status,
        method: d.method,
        purchaseOrderId: String(d.purchaseOrderId),
        poNumber: order?.number ?? "—",
        vendorName: po?.vendorName ?? "—",
        requestNumber: po?.requestNumber ?? "—",
        projectNumber: po?.projectNumber ?? "—",
        projectName: po?.projectName ?? "Unknown project",
        buyerName: d.buyerName ?? "",
        receivedByName: d.receivedByName ?? "",
        purchaseDate: d.purchaseDate,
        place: d.place ?? "",
        deliveryNoteNumber: d.deliveryNoteNumber ?? "",
        subtotal: d.subtotal ?? d.total,
        chargesTotal: d.chargesTotal ?? "0",
        total: d.total,
        difference: difference.toFixed(0),
        photoCount: d.photos.length,
        createdBy: createdBy ? { id: createdBy, name: names.get(createdBy) ?? createdBy } : null,
        createdAt: iso(d.createdAt),
        postedAt: iso(d.postedAt),
      };
    });
  }
}

export const purchaseRealizationService = new PurchaseRealizationService();
