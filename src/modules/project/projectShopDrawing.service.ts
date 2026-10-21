import { Types } from "mongoose";
import { als } from "../../core/audit/context";
import type {
  ProjectShopDrawingFileOutDto,
  ProjectShopDrawingItemOutDto,
} from "../../dto/projectShopDrawing.dto";
import { ProjectShopDrawingBoqRepo } from "../../models/projectShopDrawingBoq/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument/projectShopDrawingDocument.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem/projectShopDrawingItem.model";
import {
  assertShopDrawingFile,
  parseShopDrawingItemName,
} from "../../validation/projectShopDrawing";
import { assertProjectExists } from "./projectShared";
import {
  sameAsVersionFor,
  VersionedProjectFileService,
  type VersionedFileDoc,
  type VersionedFileExtras,
} from "./versionedProjectFile.service";

type LeanItem = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  isDeleted?: boolean;
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  createdBy?: Types.ObjectId | null;
};

async function assertLiveItem(
  projectId: string,
  itemId: string,
): Promise<LeanItem> {
  if (!Types.ObjectId.isValid(itemId)) throw new Error("Invalid item id");
  const item = (await ProjectShopDrawingItemRepo.model
    .findOne({ _id: itemId, projectId })
    .lean()
    .exec()) as LeanItem | null;
  if (!item) throw new Error("Item not found");
  if (item.isDeleted) throw new Error("Item deleted");
  return item;
}

function toFileOut(
  doc: VersionedFileDoc,
  names: Map<string, string>,
  extras?: VersionedFileExtras,
): ProjectShopDrawingFileOutDto {
  const uploadedById = doc.uploadedBy ? String(doc.uploadedBy) : null;
  const deletedById = doc.deletedBy ? String(doc.deletedBy) : null;
  return {
    id: String(doc._id),
    itemId: String(doc.itemId),
    version: doc.version,
    isCurrent: Boolean(doc.isCurrent) && doc.isDeleted !== true,
    isDeleted: doc.isDeleted === true,
    contentHash: doc.contentHash ?? null,
    sameAsVersion:
      extras?.sameAsVersion !== undefined ? extras.sameAsVersion : null,
    hasBoq: extras?.hasBoq === true,
    originalFilename: doc.originalFilename,
    contentType: doc.contentType,
    sizeBytes: doc.sizeBytes,
    uploadedAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    uploadedByName: uploadedById ? (names.get(uploadedById) ?? null) : null,
    deletedAt: doc.deletedAt ? doc.deletedAt.toISOString() : null,
    deletedByName: deletedById ? (names.get(deletedById) ?? null) : null,
    ...(extras?.linked ? { linked: true } : {}),
  };
}

const files = new VersionedProjectFileService({
  repo: ProjectShopDrawingDocumentRepo,
  scopeField: "itemId",
  noun: "file",
  toOut: toFileOut,
  assertUpload: async (projectId, itemId, file) => {
    await assertLiveItem(projectId, itemId);
    assertShopDrawingFile(file);
  },
  assertScopeLive: assertLiveItem,
  hardDelete: {
    // Hard delete also removes the revision's BOQ.
    beforeDelete: async (projectId, fileId) => {
      const boq = await ProjectShopDrawingBoqRepo.model
        .findOne({ shopDrawingFileId: fileId, projectId })
        .select({ _id: 1 })
        .lean()
        .exec();
      if (boq) await ProjectShopDrawingBoqRepo.deleteOne({ _id: boq._id });
    },
  },
});

export class ProjectShopDrawingService {
  async listByProject(projectId: string): Promise<ProjectShopDrawingItemOutDto[]> {
    await assertProjectExists(projectId);

    const items = (await ProjectShopDrawingItemRepo.model
      .find({ projectId, isDeleted: false })
      .sort({ name: 1 })
      .lean()
      .exec()) as LeanItem[];

    const { docs, names } = await files.list(
      { projectId, isDeleted: { $ne: true } },
      { version: -1 },
    );

    const boqs =
      docs.length === 0
        ? []
        : await ProjectShopDrawingBoqRepo.model
            .find({ projectId, shopDrawingFileId: { $in: docs.map((f) => f._id) } })
            .select({ shopDrawingFileId: 1 })
            .lean()
            .exec();
    const boqFileIds = new Set(boqs.map((b) => String(b.shopDrawingFileId)));

    return items.map((item) => {
      const itemId = String(item._id);
      const itemDocs = docs.filter((d) => String(d.itemId) === itemId);
      const versions = itemDocs.map((d) =>
        toFileOut(d, names, {
          sameAsVersion: sameAsVersionFor(d, itemDocs),
          hasBoq: boqFileIds.has(String(d._id)),
        }),
      );
      const current =
        versions.find((v) => v.isCurrent && !v.isDeleted) ?? null;
      return { id: itemId, name: item.name, current, versions };
    });
  }

  async createItem(
    projectId: string,
    rawName: string,
    createdByUserId?: string,
  ): Promise<ProjectShopDrawingItemOutDto> {
    await assertProjectExists(projectId);
    const name = parseShopDrawingItemName(rawName);
    const actorId =
      createdByUserId || als.getStore()?.userId || undefined;

    const dup = await ProjectShopDrawingItemRepo.model
      .findOne({ projectId, name, isDeleted: false })
      .lean()
      .exec();
    if (dup) throw new Error("An item with this name already exists");

    const created = await ProjectShopDrawingItemRepo.create({
      projectId: new Types.ObjectId(projectId),
      name,
      createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
    });

    return { id: String(created._id), name, current: null, versions: [] };
  }

  async renameItem(
    projectId: string,
    itemId: string,
    rawName: string,
  ): Promise<ProjectShopDrawingItemOutDto> {
    await assertProjectExists(projectId);
    await assertLiveItem(projectId, itemId);
    const name = parseShopDrawingItemName(rawName);

    const dup = await ProjectShopDrawingItemRepo.model
      .findOne({
        projectId,
        name,
        isDeleted: false,
        _id: { $ne: itemId },
      })
      .lean()
      .exec();
    if (dup) throw new Error("An item with this name already exists");

    const updated = await ProjectShopDrawingItemRepo.findByIdAndUpdate(itemId, {
      $set: { name },
    });
    if (!updated) throw new Error("Item not found");

    const list = await this.listByProject(projectId);
    const row = list.find((i) => i.id === itemId);
    if (!row) throw new Error("Item not found");
    return row;
  }

  async hardDeleteItem(projectId: string, itemId: string): Promise<void> {
    await assertProjectExists(projectId);
    await assertLiveItem(projectId, itemId);

    const rows = (await ProjectShopDrawingDocumentRepo.model
      .find({ projectId, itemId })
      .select({ _id: 1 })
      .lean()
      .exec()) as Array<{ _id: Types.ObjectId }>;

    for (const row of rows) {
      await files.remove(projectId, String(row._id));
    }

    const removed = await ProjectShopDrawingItemRepo.deleteOne({
      _id: itemId,
      projectId,
    });
    if (!removed) throw new Error("Item not found");
  }

  upload(
    projectId: string,
    itemId: string,
    file: Express.Multer.File,
    opts: { force?: boolean; uploadedByUserId?: string } = {},
  ): Promise<ProjectShopDrawingFileOutDto> {
    return files.upload(projectId, itemId, file, opts);
  }

  setCurrent(
    projectId: string,
    fileId: string,
  ): Promise<ProjectShopDrawingFileOutDto> {
    return files.setCurrent(projectId, fileId);
  }

  async hardDeleteFile(projectId: string, fileId: string): Promise<void> {
    await assertProjectExists(projectId);
    await files.remove(projectId, fileId);
  }

  openDownload(projectId: string, fileId: string) {
    return files.openDownload(projectId, fileId);
  }
}

export const projectShopDrawingService = new ProjectShopDrawingService();
