import Decimal from "decimal.js";
import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import { deleteFileIfExists, findFile, openDownload, uploadFile } from "../../core/gridfs";
import { logger } from "../../core/logger";
import type {
  ProductionOrderOutDto,
  SaveProductionHandoverInDto,
} from "../../dto/production.dto";
import {
  ProductionHandoverRepo,
  type ProductionHandoverInterface,
} from "../../models/productionHandover.model";
import {
  ProductionOrderRepo,
  type ProductionOrderInterface,
  type ProductionOrderStatus,
} from "../../models/productionOrder.model";
import { ProductionReportRepo } from "../../models/productionReport.model";
import { ProductionSeqCounterModel } from "../../models/seqCounter.model";
import { UserModel } from "../../models/user.model";
import { jakartaYmdString } from "../../utils/shared";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { projectNumberParts } from "../project/projectNumber";
import { notifyHandoverPosted } from "./productionNotify";
import { assertHandoverChecklist, assertReportQty } from "./production.planner";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem.model";
import { formatExportYmd, safeFilenamePart } from "../project/projectRabExport.planner";
import { formatLongDate, splitLines } from "../quotation/quotation.document";
import {
  companyLetterhead,
  loadCompanyLogo,
  productionService,
} from "./production.service";
import { buildHandoverPdf } from "./productionHandover.pdf";
import { assertFeeCoveredAfterVoid, doneOnOrder, hasVendorFee } from "./vendorWork";

/** Handover proof files; kept apart from project files (Shrink DB only cleans `project`). */
export const PRODUCTION_BUCKET = "production";

const PHOTO_MAX = 12;
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const PHOTO_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const ACTIVE_STATUSES: ProductionOrderStatus[] = ["released", "in_progress"];

type LeanOrder = ProductionOrderInterface & { _id: Types.ObjectId };
type LeanHandover = ProductionHandoverInterface & { _id: Types.ObjectId };

async function allocateNumber(): Promise<string> {
  const parts = projectNumberParts();
  const scopeKey = `bast:${parts.scopeKey}`;
  const counter = await ProductionSeqCounterModel.findOneAndUpdate(
    { scopeKey },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey } },
    { upsert: true, new: true },
  ).exec();
  if (!counter || counter.nextSeq < 1) throw new Error("Failed to allocate handover number");
  return `BAST/${parts.roman}/${parts.year}/${String(counter.nextSeq).padStart(4, "0")}`;
}

async function requireHandover(id: string): Promise<LeanHandover> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid handover id");
  const doc = (await ProductionHandoverRepo.model.findById(id).lean().exec()) as LeanHandover | null;
  if (!doc) throw new Error("Handover not found");
  return doc;
}

function requireDraft(doc: LeanHandover): void {
  if (doc.status !== "draft") throw new Error("Only a draft handover can be changed");
}

/** A released or in-progress subcon / outsource SPK. */
async function requireVendorOrder(orderId: string | Types.ObjectId): Promise<LeanOrder> {
  const order = (await ProductionOrderRepo.model.findById(orderId).lean().exec()) as LeanOrder | null;
  if (!order) throw new Error("SPK not found");
  if (!hasVendorFee(order.type)) {
    throw new Error("Handovers are for subcon and outsource SPKs; record inhouse output as a report");
  }
  if (!ACTIVE_STATUSES.includes(order.status)) {
    throw new Error("Handovers can only be recorded on a released or in-progress SPK");
  }
  return order;
}

async function receiverName(userId: string | null): Promise<string> {
  if (!userId) return "";
  const user = await UserModel.findById(userId).select({ fullName: 1, email: 1 }).lean().exec();
  if (!user) throw new Error("Receiver user not found");
  return user.fullName?.trim() || user.email || "";
}

/** Fields shared by create and update; qty is checked against what is left on the SPK. */
async function checkedFields(order: LeanOrder, input: SaveProductionHandoverInDto) {
  if (input.handoverDate > jakartaYmdString()) {
    throw new Error("handoverDate cannot be in the future");
  }
  assertReportQty(input.qty, order.qty, await doneOnOrder(order._id));
  return {
    handoverDate: input.handoverDate,
    qty: input.qty,
    deliveryNoteNumber: input.deliveryNoteNumber,
    receivedByUserId: input.receivedByUserId ? new Types.ObjectId(input.receivedByUserId) : null,
    receivedByName: await receiverName(input.receivedByUserId),
    notes: input.notes,
    checklist: input.checklist,
  };
}

export class ProductionHandoverService {
  async create(
    orderId: string,
    input: SaveProductionHandoverInDto,
    userId: string,
  ): Promise<ProductionOrderOutDto> {
    const order = await requireVendorOrder(orderId);
    const fields = await checkedFields(order, input);
    await ProductionHandoverRepo.create({
      ...fields,
      number: await allocateNumber(),
      projectId: order.projectId,
      productionOrderId: order._id,
      shopDrawingItemId: order.shopDrawingItemId,
      status: "draft",
      photos: [],
      createdBy: new Types.ObjectId(userId),
    });
    return productionService.getOrder(orderId);
  }

  async update(id: string, input: SaveProductionHandoverInDto): Promise<ProductionOrderOutDto> {
    const doc = await requireHandover(id);
    requireDraft(doc);
    const order = await requireVendorOrder(doc.productionOrderId);
    const fields = await checkedFields(order, input);
    const updated = await ProductionHandoverRepo.findOneAndUpdate(
      { _id: doc._id, status: "draft" },
      { $set: fields },
    );
    if (!updated) throw new Error("Handover is no longer a draft");
    return productionService.getOrder(String(order._id));
  }

  async remove(id: string): Promise<ProductionOrderOutDto> {
    const doc = await requireHandover(id);
    requireDraft(doc);
    const removed = await ProductionHandoverRepo.deleteOne({ _id: doc._id, status: "draft" });
    if (!removed) throw new Error("Handover not found");
    for (const p of doc.photos) {
      await deleteFileIfExists(PRODUCTION_BUCKET, p.gridFsId).catch((error: unknown) =>
        logger.warn(
          error instanceof Error ? error.message : String(error),
          "modules/production/productionHandover.service.ts",
          "remove",
        ),
      );
    }
    return productionService.getOrder(String(doc.productionOrderId));
  }

  async addPhotos(
    id: string,
    files: Express.Multer.File[],
    userId: string,
  ): Promise<ProductionOrderOutDto> {
    const doc = await requireHandover(id);
    requireDraft(doc);
    if (files.length === 0) throw new Error("Choose at least one file");
    if (doc.photos.length + files.length > PHOTO_MAX) {
      throw new Error(`At most ${PHOTO_MAX} files per handover`);
    }
    for (const f of files) {
      if (!PHOTO_TYPES.test(f.mimetype)) {
        throw new Error(`${f.originalname}: use a photo (JPG, PNG, WEBP, HEIC) or a PDF`);
      }
      if (f.size > PHOTO_MAX_BYTES) throw new Error(`${f.originalname} is larger than 15 MB`);
    }
    const uploaded: Array<ProductionHandoverInterface["photos"][number]> = [];
    try {
      for (const f of files) {
        const stored = await uploadFile(PRODUCTION_BUCKET, {
          buffer: f.buffer,
          filename: f.originalname,
          contentType: f.mimetype,
          metadata: { handoverId: id },
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
      const updated = await ProductionHandoverRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        { $push: { photos: { $each: uploaded } } },
      );
      if (!updated) throw new Error("Handover is no longer a draft");
    } catch (error) {
      for (const p of uploaded) await deleteFileIfExists(PRODUCTION_BUCKET, p.gridFsId);
      throw error;
    }
    return productionService.getOrder(String(doc.productionOrderId));
  }

  async removePhoto(id: string, photoId: string): Promise<ProductionOrderOutDto> {
    const doc = await requireHandover(id);
    requireDraft(doc);
    const photo = doc.photos.find((p) => String(p._id) === photoId);
    if (!photo) throw new Error("File not found");
    await ProductionHandoverRepo.findOneAndUpdate(
      { _id: doc._id, status: "draft" },
      { $pull: { photos: { _id: photo._id } } },
    );
    await deleteFileIfExists(PRODUCTION_BUCKET, photo.gridFsId);
    return productionService.getOrder(String(doc.productionOrderId));
  }

  async openPhoto(id: string, photoId: string) {
    const doc = await requireHandover(id);
    const photo = doc.photos.find((p) => String(p._id) === photoId);
    if (!photo) throw new Error("File not found");
    if (!(await findFile(PRODUCTION_BUCKET, photo.gridFsId))) throw new Error("File not found");
    return {
      stream: openDownload(PRODUCTION_BUCKET, photo.gridFsId),
      filename: photo.originalFilename,
      contentType: photo.contentType,
    };
  }

  /** Accept the units: the checklist must be complete and at least one proof file added. */
  async post(id: string, userId: string): Promise<ProductionOrderOutDto> {
    const doc = await requireHandover(id);
    requireDraft(doc);
    const order = await requireVendorOrder(doc.productionOrderId);
    assertHandoverChecklist(doc.checklist);
    if (doc.photos.length === 0) {
      throw new Error("Add at least one file (signed handover, surat jalan or photo) before posting");
    }
    if (doc.handoverDate > jakartaYmdString()) {
      throw new Error("handoverDate cannot be in the future");
    }
    await withTx(async () => {
      assertReportQty(doc.qty, order.qty, await doneOnOrder(order._id));
      const report = await ProductionReportRepo.create({
        projectId: order.projectId,
        productionOrderId: order._id,
        shopDrawingItemId: order.shopDrawingItemId,
        handoverId: doc._id,
        qtyDone: doc.qty,
        reportDate: doc.handoverDate,
        notes: `Handover ${doc.number}`,
        reportedBy: new Types.ObjectId(userId),
        isVoided: false,
      });
      const updated = await ProductionHandoverRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        {
          $set: {
            status: "posted",
            postedAt: new Date(),
            postedBy: new Types.ObjectId(userId),
            productionReportId: report._id,
          },
        },
      );
      if (!updated) throw new Error("Handover is no longer a draft");
      if (order.status === "released") {
        await ProductionOrderRepo.findOneAndUpdate(
          { _id: order._id, status: "released" },
          { $set: { status: "in_progress" } },
        );
      }
    });
    await notifyHandoverPosted({ handoverId: id, actorUserId: userId });
    return productionService.getOrder(String(order._id));
  }

  /** Undo a posted handover and its report; refused while the vendor fee already relies on it. */
  async void(id: string, userId: string, reason: string): Promise<ProductionOrderOutDto> {
    const doc = await requireHandover(id);
    if (doc.status !== "posted") throw new Error("Only a posted handover can be voided");
    const order = await requireVendorOrder(doc.productionOrderId);
    const doneAfter = formatDecimal(new Decimal(await doneOnOrder(order._id)).minus(doc.qty));
    await assertFeeCoveredAfterVoid(order, doneAfter);
    const now = new Date();
    const by = new Types.ObjectId(userId);
    await withTx(async () => {
      const updated = await ProductionHandoverRepo.findOneAndUpdate(
        { _id: doc._id, status: "posted" },
        { $set: { status: "voided", voidedAt: now, voidedBy: by, voidReason: reason } },
      );
      if (!updated) throw new Error("Failed to void handover");
      if (doc.productionReportId) {
        await ProductionReportRepo.findOneAndUpdate(
          { _id: doc.productionReportId, isVoided: false },
          {
            $set: {
              isVoided: true,
              voidedAt: now,
              voidedBy: by,
              voidReason: `Handover ${doc.number} voided: ${reason}`,
            },
          },
        );
      }
    });
    return productionService.getOrder(String(order._id));
  }
}

export const productionHandoverService = new ProductionHandoverService();

/** Berita Acara Serah Terima as a printable PDF; drafts print as DRAFT. */
export async function exportHandoverPdf(
  id: string,
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const doc = await requireHandover(id);
  const order = await productionService.getOrder(String(doc.productionOrderId));
  const item = await ProjectShopDrawingItemRepo.model
    .findById(order.shopDrawingItemId)
    .select({ code: 1, name: 1, dimension: 1 })
    .lean()
    .exec();
  const vendors = [
    ...new Set(
      order.purchaseOrders
        .filter((p) => p.vendorFee && p.status === "approved")
        .map((p) => p.vendorName),
    ),
  ];
  const suffix = doc.status === "draft" ? " (DRAFT)" : doc.status === "voided" ? " (DIBATALKAN)" : "";
  const { companyName, letterhead } = companyLetterhead();
  const date = formatLongDate(new Date(`${doc.handoverDate}T00:00:00+07:00`));
  const buffer = await buildHandoverPdf(
    {
      companyName,
      letterhead,
      title: `BERITA ACARA SERAH TERIMA${suffix}`,
      meta: {
        left: [
          ["Proyek", order.projectNumber],
          ["Nama Proyek", order.projectName],
          ["Vendor", vendors.join(", ") || "-"],
        ],
        right: [
          ["No. BAST", doc.number],
          ["Tanggal", date],
          ["No. SPK", order.number],
          ["Surat jalan", doc.deliveryNoteNumber || "-"],
        ],
      },
      item: {
        code: item?.code ?? "",
        name: item?.name ?? order.itemLabel,
        dimension: item?.dimension ?? "",
        qty: doc.qty,
        spkQty: order.qty,
      },
      checklist: doc.checklist.map((c) => ({
        label: c.label,
        result: c.result === "ok" ? "OK" : c.result === "not_ok" ? "Tidak OK" : "-",
        note: c.note ?? "",
      })),
      notes: splitLines(doc.notes ?? ""),
      signDate: date,
      vendorName: vendors[0] ?? null,
      receiverName: doc.receivedByName || null,
    },
    await loadCompanyLogo(),
  );
  const filename = [
    "BAST",
    safeFilenamePart(doc.number),
    doc.status === "draft" ? "DRAFT" : null,
    formatExportYmd(),
  ]
    .filter(Boolean)
    .join("_");
  return { buffer, filename: `${filename}.pdf`, contentType: "application/pdf" };
}
