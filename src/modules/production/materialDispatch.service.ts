import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import { deleteFileIfExists, findFile, openDownload, uploadFile } from "../../core/gridfs";
import { logger } from "../../core/logger";
import type {
  ProductionOrderOutDto,
  SaveMaterialDispatchInDto,
} from "../../dto/production.dto";
import {
  MaterialDispatchRepo,
  type MaterialDispatchInterface,
} from "../../models/materialDispatch.model";
import {
  ProductionOrderRepo,
  type ProductionOrderInterface,
  type ProductionOrderStatus,
} from "../../models/productionOrder.model";
import { ProductionSeqCounterModel } from "../../models/seqCounter.model";
import { UserModel } from "../../models/user.model";
import { jakartaYmdString } from "../../utils/shared";
import { projectNumberParts } from "../project/projectNumber";
import { formatExportYmd, safeFilenamePart } from "../project/projectRabExport.planner";
import { formatLongDate, splitLines } from "../quotation/quotation.document";
import { notifyDispatchEvent } from "./productionNotify";
import { checkDispatchLines } from "./production.planner";
import { companyLetterhead, loadCompanyLogo, productionService } from "./production.service";
import { PRODUCTION_BUCKET } from "./productionHandover.service";
import { buildDispatchPdf } from "./materialDispatch.pdf";
import { dispatchable, dispatchVendorOf, type LeanDispatch } from "./materialDispatch.queries";

const PHOTO_MAX = 12;
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const PHOTO_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const ACTIVE_STATUSES: ProductionOrderStatus[] = ["released", "in_progress"];

type LeanOrder = ProductionOrderInterface & { _id: Types.ObjectId };

async function allocateNumber(): Promise<string> {
  const parts = projectNumberParts();
  const scopeKey = `sj:${parts.scopeKey}`;
  const counter = await ProductionSeqCounterModel.findOneAndUpdate(
    { scopeKey },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey } },
    { upsert: true, new: true },
  ).exec();
  if (!counter || counter.nextSeq < 1) throw new Error("Failed to allocate surat jalan number");
  return `SJ/${parts.roman}/${parts.year}/${String(counter.nextSeq).padStart(4, "0")}`;
}

async function requireDispatch(id: string): Promise<LeanDispatch> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid dispatch id");
  const doc = (await MaterialDispatchRepo.model.findById(id).lean().exec()) as LeanDispatch | null;
  if (!doc) throw new Error("Dispatch not found");
  return doc;
}

/** A released or in-progress subcon SPK. */
async function requireSubconOrder(orderId: string | Types.ObjectId): Promise<LeanOrder> {
  const order = (await ProductionOrderRepo.model.findById(orderId).lean().exec()) as LeanOrder | null;
  if (!order) throw new Error("SPK not found");
  if (order.type !== "subcon") throw new Error("Material is only sent to the vendor on a subcon SPK");
  if (!ACTIVE_STATUSES.includes(order.status)) {
    throw new Error("Material can only be sent on a released or in-progress SPK");
  }
  return order;
}

/** Lines checked against what is at our warehouse and not sent or on its way. */
async function checkedLines(order: LeanOrder, lines: SaveMaterialDispatchInDto["lines"], exceptId?: Types.ObjectId) {
  return checkDispatchLines(lines, await dispatchable(order, exceptId)).map((l) => ({
    materialItemId: new Types.ObjectId(l.materialItemId),
    itemUomId: new Types.ObjectId(l.itemUomId),
    qty: l.qty,
  }));
}

function plainLines(doc: LeanDispatch): SaveMaterialDispatchInDto["lines"] {
  return doc.lines.map((l) => ({
    materialItemId: String(l.materialItemId),
    itemUomId: String(l.itemUomId),
    qty: l.qty,
  }));
}

async function displayName(userId: string): Promise<string> {
  const user = await UserModel.findById(userId).select({ fullName: 1, email: 1 }).lean().exec();
  return user?.fullName?.trim() || user?.email || "";
}

/** One status change, refused when the dispatch moved meanwhile. */
async function transition(doc: LeanDispatch, from: MaterialDispatchInterface["status"], set: Record<string, unknown>) {
  const updated = await MaterialDispatchRepo.findOneAndUpdate({ _id: doc._id, status: from }, { $set: set });
  if (!updated) throw new Error("Dispatch changed meanwhile; reload it");
}

/**
 * Surat Jalan ke vendor: our material from the warehouse to a subcon SPK's
 * vendor (the approved fee PO's vendor). Requested, approved by another
 * person, then marked sent with proof.
 */
export class MaterialDispatchService {
  async create(orderId: string, input: SaveMaterialDispatchInDto, userId: string): Promise<ProductionOrderOutDto> {
    const order = await requireSubconOrder(orderId);
    const vendor = await dispatchVendorOf(order);
    if (!vendor) {
      throw new Error("Approve the vendor fee PO first: it decides which vendor the material goes to");
    }
    await withTx(async () => {
      const lines = await checkedLines(order, input.lines);
      await MaterialDispatchRepo.create({
        number: await allocateNumber(),
        projectId: order.projectId,
        productionOrderId: order._id,
        shopDrawingItemId: order.shopDrawingItemId,
        vendorId: vendor.vendorId,
        feePurchaseOrderId: vendor.purchaseOrderId,
        status: "draft",
        dispatchDate: input.dispatchDate,
        lines,
        notes: input.notes,
        receivedByName: input.receivedByName,
        photos: [],
        createdBy: new Types.ObjectId(userId),
      });
    });
    return productionService.getOrder(orderId);
  }

  /** Edit a draft, or a rejected one (it goes back to draft). */
  async update(id: string, input: SaveMaterialDispatchInDto): Promise<ProductionOrderOutDto> {
    const doc = await requireDispatch(id);
    if (doc.status !== "draft" && doc.status !== "rejected") {
      throw new Error("Only a draft or rejected dispatch can be changed");
    }
    const order = await requireSubconOrder(doc.productionOrderId);
    await withTx(async () => {
      const lines = await checkedLines(order, input.lines, doc._id);
      await transition(doc, doc.status, {
        status: "draft",
        dispatchDate: input.dispatchDate,
        lines,
        notes: input.notes,
        receivedByName: input.receivedByName,
        rejectedAt: null,
        rejectedBy: null,
        rejectReason: "",
      });
    });
    return productionService.getOrder(String(order._id));
  }

  async remove(id: string): Promise<ProductionOrderOutDto> {
    const doc = await requireDispatch(id);
    if (doc.status !== "draft") throw new Error("Only a draft can be deleted; cancel it instead");
    const removed = await MaterialDispatchRepo.deleteOne({ _id: doc._id, status: "draft" });
    if (!removed) throw new Error("Dispatch not found");
    for (const p of doc.photos) {
      await deleteFileIfExists(PRODUCTION_BUCKET, p.gridFsId).catch((error: unknown) =>
        logger.warn(
          error instanceof Error ? error.message : String(error),
          "modules/production/materialDispatch.service.ts",
          "remove",
        ),
      );
    }
    return productionService.getOrder(String(doc.productionOrderId));
  }

  async submit(id: string): Promise<ProductionOrderOutDto> {
    const doc = await requireDispatch(id);
    if (doc.status !== "draft") throw new Error("Only a draft can be sent for approval");
    const order = await requireSubconOrder(doc.productionOrderId);
    await withTx(async () => {
      await checkedLines(order, plainLines(doc), doc._id);
      await transition(doc, "draft", { status: "pending_approval", submittedAt: new Date() });
    });
    await notifyDispatchEvent({ kind: "submitted", dispatchId: id, actorUserId: doc.createdBy ? String(doc.createdBy) : "" });
    return productionService.getOrder(String(order._id));
  }

  /** Someone other than the requester lets the material go. */
  async approve(id: string, userId: string): Promise<ProductionOrderOutDto> {
    const doc = await requireDispatch(id);
    if (doc.status !== "pending_approval") throw new Error("This dispatch is not waiting for approval");
    if (String(doc.createdBy) === userId) throw new Error("You cannot approve a dispatch you requested");
    const order = await requireSubconOrder(doc.productionOrderId);
    await withTx(async () => {
      await checkedLines(order, plainLines(doc), doc._id);
      await transition(doc, "pending_approval", {
        status: "approved",
        approvedAt: new Date(),
        approvedBy: new Types.ObjectId(userId),
        approvedByName: await displayName(userId),
      });
    });
    await notifyDispatchEvent({ kind: "approved", dispatchId: id, actorUserId: userId });
    return productionService.getOrder(String(order._id));
  }

  async reject(id: string, userId: string, reason: string): Promise<ProductionOrderOutDto> {
    const doc = await requireDispatch(id);
    if (doc.status !== "pending_approval") throw new Error("This dispatch is not waiting for approval");
    if (String(doc.createdBy) === userId) throw new Error("You cannot reject a dispatch you requested");
    await transition(doc, "pending_approval", {
      status: "rejected",
      rejectedAt: new Date(),
      rejectedBy: new Types.ObjectId(userId),
      rejectReason: reason,
    });
    await notifyDispatchEvent({ kind: "rejected", dispatchId: id, actorUserId: userId });
    return productionService.getOrder(String(doc.productionOrderId));
  }

  /** The material left: needs a photo or the signed surat jalan; from now it counts as at the vendor. */
  async send(
    id: string,
    userId: string,
    input: { dispatchDate: string; receivedByName: string },
  ): Promise<ProductionOrderOutDto> {
    const doc = await requireDispatch(id);
    if (doc.status !== "approved") throw new Error("Only an approved dispatch can be marked sent");
    if (doc.photos.length === 0) {
      throw new Error("Add a photo of the goods or the signed surat jalan before marking it sent");
    }
    if (input.dispatchDate > jakartaYmdString()) throw new Error("dispatchDate cannot be in the future");
    const order = await requireSubconOrder(doc.productionOrderId);
    await withTx(async () => {
      await checkedLines(order, plainLines(doc), doc._id);
      await transition(doc, "approved", {
        status: "sent",
        dispatchDate: input.dispatchDate,
        receivedByName: input.receivedByName || doc.receivedByName,
        sentAt: new Date(),
        sentBy: new Types.ObjectId(userId),
      });
    });
    return productionService.getOrder(String(order._id));
  }

  async cancel(id: string, userId: string, reason: string): Promise<ProductionOrderOutDto> {
    const doc = await requireDispatch(id);
    if (!["pending_approval", "approved", "rejected"].includes(doc.status)) {
      throw new Error(doc.status === "draft" ? "Delete a draft instead" : "This dispatch cannot be cancelled");
    }
    await transition(doc, doc.status, {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: new Types.ObjectId(userId),
      cancelReason: reason,
    });
    return productionService.getOrder(String(doc.productionOrderId));
  }

  /** A sent dispatch that did not happen (or was wrong): the material counts as at our warehouse again. */
  async void(id: string, userId: string, reason: string): Promise<ProductionOrderOutDto> {
    const doc = await requireDispatch(id);
    if (doc.status !== "sent") throw new Error("Only a sent dispatch can be voided");
    await transition(doc, "sent", {
      status: "voided",
      voidedAt: new Date(),
      voidedBy: new Types.ObjectId(userId),
      voidReason: reason,
    });
    return productionService.getOrder(String(doc.productionOrderId));
  }

  async addPhotos(id: string, files: Express.Multer.File[], userId: string): Promise<ProductionOrderOutDto> {
    const doc = await requireDispatch(id);
    if (!["draft", "pending_approval", "approved", "rejected"].includes(doc.status)) {
      throw new Error("Files can be added until the dispatch is sent");
    }
    if (files.length === 0) throw new Error("Choose at least one file");
    if (doc.photos.length + files.length > PHOTO_MAX) throw new Error(`At most ${PHOTO_MAX} files per dispatch`);
    for (const f of files) {
      if (!PHOTO_TYPES.test(f.mimetype)) {
        throw new Error(`${f.originalname}: use a photo (JPG, PNG, WEBP, HEIC) or a PDF`);
      }
      if (f.size > PHOTO_MAX_BYTES) throw new Error(`${f.originalname} is larger than 15 MB`);
    }
    const uploaded: MaterialDispatchInterface["photos"] = [];
    try {
      for (const f of files) {
        const stored = await uploadFile(PRODUCTION_BUCKET, {
          buffer: f.buffer,
          filename: f.originalname,
          contentType: f.mimetype,
          metadata: { dispatchId: id },
        });
        uploaded.push({
          gridFsId: stored.id,
          originalFilename: f.originalname,
          contentType: f.mimetype,
          sizeBytes: f.size,
          uploadedBy: new Types.ObjectId(userId),
          uploadedAt: new Date(),
        });
      }
      const updated = await MaterialDispatchRepo.findOneAndUpdate(
        { _id: doc._id, status: doc.status },
        { $push: { photos: { $each: uploaded } } },
      );
      if (!updated) throw new Error("Dispatch changed meanwhile; reload it");
    } catch (error) {
      for (const p of uploaded) await deleteFileIfExists(PRODUCTION_BUCKET, p.gridFsId);
      throw error;
    }
    return productionService.getOrder(String(doc.productionOrderId));
  }

  async removePhoto(id: string, photoId: string): Promise<ProductionOrderOutDto> {
    const doc = await requireDispatch(id);
    if (doc.status === "sent" || doc.status === "voided" || doc.status === "cancelled") {
      throw new Error("Files of a sent dispatch cannot be removed");
    }
    const photo = doc.photos.find((p) => String(p._id) === photoId);
    if (!photo) throw new Error("File not found");
    await MaterialDispatchRepo.findOneAndUpdate({ _id: doc._id }, { $pull: { photos: { _id: photo._id } } });
    await deleteFileIfExists(PRODUCTION_BUCKET, photo.gridFsId);
    return productionService.getOrder(String(doc.productionOrderId));
  }

  async openPhoto(id: string, photoId: string) {
    const doc = await requireDispatch(id);
    const photo = doc.photos.find((p) => String(p._id) === photoId);
    if (!photo) throw new Error("File not found");
    if (!(await findFile(PRODUCTION_BUCKET, photo.gridFsId))) throw new Error("File not found");
    return {
      stream: openDownload(PRODUCTION_BUCKET, photo.gridFsId),
      filename: photo.originalFilename,
      contentType: photo.contentType,
    };
  }
}

export const materialDispatchService = new MaterialDispatchService();

const STATUS_SUFFIX: Partial<Record<MaterialDispatchInterface["status"], string>> = {
  draft: " (DRAFT)",
  pending_approval: " (MENUNGGU PERSETUJUAN)",
  rejected: " (DITOLAK)",
  cancelled: " (DIBATALKAN)",
  voided: " (DIBATALKAN)",
};

/** Surat Jalan ke vendor as a printable PDF. */
export async function exportDispatchPdf(
  id: string,
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const doc = await requireDispatch(id);
  const order = await productionService.getOrder(String(doc.productionOrderId));
  const dispatch = order.dispatches.find((d) => d.id === id);
  if (!dispatch) throw new Error("Dispatch not found");
  const { companyName, letterhead } = companyLetterhead();
  const date = formatLongDate(new Date(`${doc.dispatchDate}T00:00:00+07:00`));
  const buffer = await buildDispatchPdf(
    {
      companyName,
      letterhead,
      title: `SURAT JALAN${STATUS_SUFFIX[doc.status] ?? ""}`,
      meta: {
        left: [
          ["Kepada", dispatch.vendorName],
          ["Proyek", order.projectNumber],
          ["Nama Proyek", order.projectName],
        ],
        right: [
          ["No. SJ", doc.number],
          ["Tanggal", date],
          ["No. SPK", order.number],
          ["No. PO jasa", dispatch.feePurchaseOrderNumber],
        ],
      },
      item: order.itemLabel,
      lines: dispatch.lines.map((l) => ({ code: l.materialCode, name: l.materialName, qty: l.qty, uom: l.uomSymbol })),
      notes: splitLines(doc.notes ?? ""),
      signDate: date,
      senderName: doc.approvedByName || null,
      receiverName: doc.receivedByName || null,
    },
    await loadCompanyLogo(),
  );
  const filename = ["SJ", safeFilenamePart(doc.number), doc.status === "sent" ? null : "DRAFT", formatExportYmd()]
    .filter(Boolean)
    .join("_");
  return { buffer, filename: `${filename}.pdf`, contentType: "application/pdf" };
}
