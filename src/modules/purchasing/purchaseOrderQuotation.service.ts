import { createHash } from "crypto";
import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import {
  deleteFileIfExists,
  findFile,
  openDownload,
  readFileBuffer,
} from "../../core/gridfs";
import type {
  PurchaseOrderQuotationOutDto,
  PurchaseOrderQuotationsOutDto,
} from "../../dto/purchasing.dto";
import { PurchaseOrderRepo } from "../../models/purchaseOrder.model";
import {
  PurchaseOrderQuotationRepo,
  type PurchaseOrderQuotationInterface,
} from "../../models/purchaseOrderQuotation.model";
import { userEmailsById } from "../../utils/shared";
import { uploadDedupedBlob } from "../project/projectShared";
import { sameAsVersionFor } from "../project/versionedProjectFile.service";

export const PURCHASING_BUCKET = "purchasing";
export const QUOTATION_MAX_BYTES = 15 * 1024 * 1024;
const QUOTATION_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

type Row = PurchaseOrderQuotationInterface & { _id: Types.ObjectId };

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function rowsFor(purchaseOrderId: Types.ObjectId): Promise<Row[]> {
  return (await PurchaseOrderQuotationRepo.model
    .find({ purchaseOrderId })
    .sort({ version: -1 })
    .lean()
    .exec()) as Row[];
}

async function requireRow(purchaseOrderId: Types.ObjectId, fileId: string): Promise<Row> {
  const row = (await PurchaseOrderQuotationRepo.model
    .findOne({ _id: new Types.ObjectId(fileId), purchaseOrderId })
    .lean()
    .exec()) as Row | null;
  if (!row) throw new Error("Quotation not found");
  return row;
}

/** Un-mark the current version (audited per row; normally just one). */
async function clearCurrent(purchaseOrderId: Types.ObjectId): Promise<void> {
  const current = await PurchaseOrderQuotationRepo.model
    .find({ purchaseOrderId, isCurrent: true })
    .select({ _id: 1 })
    .lean()
    .exec();
  for (const row of current) {
    await PurchaseOrderQuotationRepo.findByIdAndUpdate(String(row._id), {
      $set: { isCurrent: false },
    });
  }
}

/** Purge a blob once no live version references it. */
async function purgeUnreferenced(gridFsId: Types.ObjectId): Promise<void> {
  const live = await PurchaseOrderQuotationRepo.model
    .countDocuments({ gridFsId, isDeleted: false })
    .exec();
  if (live === 0) await deleteFileIfExists(PURCHASING_BUCKET, gridFsId);
}

/**
 * POs made before versioning kept quotations in an embedded array. Turn them
 * into versions (oldest first, newest current) the first time the PO is read.
 */
async function migrateLegacy(purchaseOrderId: Types.ObjectId): Promise<void> {
  const po = await PurchaseOrderRepo.model
    .findById(purchaseOrderId)
    .select({ quotations: 1 })
    .lean()
    .exec();
  const legacy = [...(po?.quotations ?? [])].sort(
    (a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime(),
  );
  if (legacy.length === 0) return;
  const existing = await PurchaseOrderQuotationRepo.model
    .countDocuments({ purchaseOrderId })
    .exec();
  if (existing === 0) {
    const hashes: string[] = [];
    for (const q of legacy) {
      const buffer = await readFileBuffer(PURCHASING_BUCKET, q.gridFsId).catch(() => null);
      hashes.push(
        buffer
          ? createHash("sha256").update(buffer).digest("hex")
          : `missing:${String(q.gridFsId)}`,
      );
    }
    await withTx(async () => {
      for (const [i, q] of legacy.entries()) {
        await PurchaseOrderQuotationRepo.create({
          purchaseOrderId,
          version: i + 1,
          isCurrent: i === legacy.length - 1,
          gridFsId: q.gridFsId,
          contentHash: hashes[i]!,
          forceDifferent: false,
          originalFilename: q.originalFilename,
          contentType: q.contentType,
          sizeBytes: q.sizeBytes,
          uploadedBy: q.uploadedBy ?? null,
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
        });
      }
    });
  }
  await PurchaseOrderRepo.findOneAndUpdate(
    { _id: purchaseOrderId },
    { $set: { quotations: [] } },
  );
}

export async function listQuotations(
  purchaseOrderId: Types.ObjectId,
): Promise<PurchaseOrderQuotationsOutDto> {
  await migrateLegacy(purchaseOrderId);
  const rows = await rowsFor(purchaseOrderId);
  const names = await userEmailsById(
    rows.flatMap((r) => [r.uploadedBy, r.deletedBy].filter(Boolean).map(String)),
  );
  const versions = rows.map((r): PurchaseOrderQuotationOutDto => {
    const uploadedBy = r.uploadedBy ? String(r.uploadedBy) : null;
    const deletedBy = r.deletedBy ? String(r.deletedBy) : null;
    return {
      id: String(r._id),
      version: r.version,
      isCurrent: r.isCurrent,
      isDeleted: r.isDeleted,
      sameAsVersion: sameAsVersionFor(r, rows),
      originalFilename: r.originalFilename,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      uploadedAt: iso(r.createdAt),
      uploadedByName: uploadedBy ? (names.get(uploadedBy) ?? null) : null,
      deletedAt: iso(r.deletedAt),
      deletedByName: deletedBy ? (names.get(deletedBy) ?? null) : null,
    };
  });
  return {
    current: versions.find((v) => v.isCurrent && !v.isDeleted) ?? null,
    versions,
  };
}

/** New version, made current. Identical content reuses the stored blob unless forced. */
export async function uploadQuotation(
  purchaseOrderId: Types.ObjectId,
  file: Express.Multer.File,
  opts: { force: boolean; userId: string },
): Promise<{ linked: boolean }> {
  if (!QUOTATION_TYPES.test(file.mimetype)) {
    throw new Error(`${file.originalname}: use a PDF or a photo (JPG, PNG, WEBP, HEIC)`);
  }
  if (file.size > QUOTATION_MAX_BYTES) {
    throw new Error(`${file.originalname} is larger than 15 MB`);
  }
  await migrateLegacy(purchaseOrderId);
  const contentHash = createHash("sha256").update(file.buffer).digest("hex");
  const { gridFsId, linked, createdNewBlob } = await uploadDedupedBlob({
    bucket: PURCHASING_BUCKET,
    buffer: file.buffer,
    filename: file.originalname,
    contentType: file.mimetype,
    contentHash,
    force: opts.force,
    metadata: { purchaseOrderId: String(purchaseOrderId), contentHash },
    findExistingIds: async () =>
      (
        await PurchaseOrderQuotationRepo.model
          .find({ contentHash })
          .sort({ createdAt: -1 })
          .select({ gridFsId: 1 })
          .lean()
          .exec()
      ).map((r) => r.gridFsId),
  });
  try {
    await withTx(async () => {
      const latest = await PurchaseOrderQuotationRepo.model
        .findOne({ purchaseOrderId })
        .sort({ version: -1 })
        .select({ version: 1 })
        .lean()
        .exec();
      await clearCurrent(purchaseOrderId);
      await PurchaseOrderQuotationRepo.create({
        purchaseOrderId,
        version: (latest?.version ?? 0) + 1,
        isCurrent: true,
        gridFsId,
        contentHash,
        forceDifferent: opts.force,
        originalFilename: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        uploadedBy: new Types.ObjectId(opts.userId),
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
      });
    });
  } catch (error) {
    if (createdNewBlob) await deleteFileIfExists(PURCHASING_BUCKET, gridFsId);
    throw error;
  }
  return { linked };
}

export async function setCurrentQuotation(
  purchaseOrderId: Types.ObjectId,
  fileId: string,
): Promise<void> {
  const target = await requireRow(purchaseOrderId, fileId);
  if (target.isDeleted) throw new Error("Cannot use a deleted version");
  if (target.isCurrent) return;
  await withTx(async () => {
    await clearCurrent(purchaseOrderId);
    await PurchaseOrderQuotationRepo.findByIdAndUpdate(String(target._id), {
      $set: { isCurrent: true },
    });
  });
}

export async function renameQuotation(
  purchaseOrderId: Types.ObjectId,
  fileId: string,
  originalFilename: string,
): Promise<void> {
  const row = await requireRow(purchaseOrderId, fileId);
  if (row.isDeleted) throw new Error("Cannot rename a deleted version");
  await PurchaseOrderQuotationRepo.findByIdAndUpdate(String(row._id), {
    $set: { originalFilename },
  });
}

/** Soft delete (kept in history); the newest live version becomes current. */
export async function deleteQuotation(
  purchaseOrderId: Types.ObjectId,
  fileId: string,
  userId: string,
): Promise<void> {
  const row = await requireRow(purchaseOrderId, fileId);
  if (row.isDeleted) throw new Error("Quotation already deleted");
  await withTx(async () => {
    await PurchaseOrderQuotationRepo.findByIdAndUpdate(String(row._id), {
      $set: {
        isDeleted: true,
        isCurrent: false,
        deletedAt: new Date(),
        deletedBy: new Types.ObjectId(userId),
      },
    });
    if (row.isCurrent) {
      const next = await PurchaseOrderQuotationRepo.model
        .findOne({ purchaseOrderId, isDeleted: false, _id: { $ne: row._id } })
        .sort({ version: -1 })
        .lean()
        .exec();
      if (next) {
        await PurchaseOrderQuotationRepo.findByIdAndUpdate(String(next._id), {
          $set: { isCurrent: true },
        });
      }
    }
  });
  await purgeUnreferenced(row.gridFsId);
}

export async function openQuotation(purchaseOrderId: Types.ObjectId, fileId: string) {
  await migrateLegacy(purchaseOrderId);
  const row = await requireRow(purchaseOrderId, fileId);
  if (row.isDeleted) throw new Error("Quotation deleted");
  if (!(await findFile(PURCHASING_BUCKET, row.gridFsId))) {
    throw new Error("File not found");
  }
  return {
    stream: openDownload(PURCHASING_BUCKET, row.gridFsId),
    filename: row.originalFilename,
    contentType: row.contentType,
  };
}

/** A deleted draft PO takes its quotation versions with it. */
export async function purgeQuotations(purchaseOrderId: Types.ObjectId): Promise<void> {
  const rows = await rowsFor(purchaseOrderId);
  await PurchaseOrderQuotationRepo.deleteMany({ purchaseOrderId });
  for (const gridFsId of new Set(rows.map((r) => String(r.gridFsId)))) {
    await purgeUnreferenced(new Types.ObjectId(gridFsId));
  }
}

/** Current version's filename, for the PO PDF. */
export async function currentQuotationName(
  purchaseOrderId: Types.ObjectId,
): Promise<string | null> {
  return (await listQuotations(purchaseOrderId)).current?.originalFilename ?? null;
}
