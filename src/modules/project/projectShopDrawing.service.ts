import { extname } from "path";
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
  parseShopDrawingItemCategory,
  parseShopDrawingItemName,
} from "../../validation/projectShopDrawing";
import { rabLockState } from "./projectRabLock";
import { assertProjectExists } from "./projectShared";
import {
  sameAsVersionFor,
  VersionedProjectFileService,
  type VersionedFileDoc,
  type VersionedFileExtras,
} from "./versionedProjectFile.service";

/** Locked RAB with no open change — version switch needs a change first. */
async function assertCanSwitchShopDrawingCurrent(
  projectId: string,
): Promise<void> {
  const { locked, change } = await rabLockState(projectId);
  if (locked && !change) {
    throw new Error(
      "RAB is locked: open a change before switching the current shop drawing version",
    );
  }
}

/**
 * While the RAB is locked, a file that feeds (or fed) the locked numbers must
 * not disappear outside a commit: the current version, any file with a BOQ
 * (live or in the open change), and anything that was current when the
 * change was opened (Discard restores it).
 */
async function assertFilesDeletableWhileLocked(
  projectId: string,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return;
  const { locked, change } = await rabLockState(projectId);
  if (!locked) return;

  const protectedIds = new Set<string>();
  const [current, liveBoqs] = await Promise.all([
    ProjectShopDrawingDocumentRepo.model
      .find({
        projectId,
        _id: { $in: fileIds },
        isCurrent: true,
        isDeleted: { $ne: true },
      })
      .select({ _id: 1 })
      .lean()
      .exec(),
    ProjectShopDrawingBoqRepo.model
      .find({ projectId, shopDrawingFileId: { $in: fileIds } })
      .select({ shopDrawingFileId: 1 })
      .lean()
      .exec(),
  ]);
  for (const f of current) protectedIds.add(String(f._id));
  for (const b of liveBoqs) protectedIds.add(String(b.shopDrawingFileId));
  for (const b of change?.boqs ?? []) protectedIds.add(String(b.shopDrawingFileId));
  for (const c of change?.baselineCurrentFiles ?? []) {
    protectedIds.add(String(c.shopDrawingFileId));
  }

  if (fileIds.some((id) => protectedIds.has(id))) {
    throw new Error(
      change
        ? "RAB is locked: this file is (or was) the current version or has a BOQ. Switch the version / remove its BOQ in this change and commit before deleting it"
        : "RAB is locked: this file is the current version or has a BOQ. Open a change, switch the version / remove its BOQ, and commit before deleting it",
    );
  }
}

/** File ids that have a BOQ, as seen by the open change when there is one. */
async function boqFileIdsFor(
  projectId: string,
  fileIds: Types.ObjectId[],
): Promise<Set<string>> {
  const { change } = await rabLockState(projectId);
  if (change) {
    return new Set(change.boqs.map((b) => String(b.shopDrawingFileId)));
  }
  if (fileIds.length === 0) return new Set();
  const boqs = await ProjectShopDrawingBoqRepo.model
    .find({ projectId, shopDrawingFileId: { $in: fileIds } })
    .select({ shopDrawingFileId: 1 })
    .lean()
    .exec();
  return new Set(boqs.map((b) => String(b.shopDrawingFileId)));
}

async function isRabLockedWithoutChange(projectId: string): Promise<boolean> {
  const { locked, change } = await rabLockState(projectId);
  return locked && !change;
}

function shopDrawingOriginalFilename(
  version: number,
  itemName: string,
  sourceFilename: string,
): string {
  return `V${version}-${itemName}${extname(sourceFilename)}`;
}

type LeanItem = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  category?: string | null;
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

    const boqFileIds = await boqFileIdsFor(
      projectId,
      docs.map((f) => f._id),
    );

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
      return {
        id: itemId,
        name: item.name,
        category: item.category ?? null,
        current,
        versions,
      };
    });
  }

  async createItem(
    projectId: string,
    rawName: string,
    rawCategory: string | null,
    createdByUserId?: string,
  ): Promise<ProjectShopDrawingItemOutDto> {
    await assertProjectExists(projectId);
    const name = parseShopDrawingItemName(rawName);
    const category = parseShopDrawingItemCategory(rawCategory);
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
      category,
      createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
    });

    return {
      id: String(created._id),
      name,
      category,
      current: null,
      versions: [],
    };
  }

  async renameItem(
    projectId: string,
    itemId: string,
    rawName: string,
    rawCategory: string | null,
  ): Promise<ProjectShopDrawingItemOutDto> {
    await assertProjectExists(projectId);
    const existing = await assertLiveItem(projectId, itemId);
    const name = parseShopDrawingItemName(rawName);
    const category = parseShopDrawingItemCategory(rawCategory);

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
      $set: { name, category },
    });
    if (!updated) throw new Error("Item not found");

    if (existing.name !== name) {
      const docs = (await ProjectShopDrawingDocumentRepo.model
        .find({ projectId, itemId })
        .select({ _id: 1, version: 1, originalFilename: 1 })
        .lean()
        .exec()) as Array<{
        _id: Types.ObjectId;
        version: number;
        originalFilename: string;
      }>;
      for (const doc of docs) {
        await files.rename(
          projectId,
          String(doc._id),
          shopDrawingOriginalFilename(doc.version, name, doc.originalFilename),
        );
      }
    }

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
    await assertFilesDeletableWhileLocked(
      projectId,
      rows.map((r) => String(r._id)),
    );

    for (const row of rows) {
      await files.remove(projectId, String(row._id));
    }

    const removed = await ProjectShopDrawingItemRepo.deleteOne({
      _id: itemId,
      projectId,
    });
    if (!removed) throw new Error("Item not found");
  }

  async upload(
    projectId: string,
    itemId: string,
    file: Express.Multer.File,
    opts: { force?: boolean; uploadedByUserId?: string } = {},
  ): Promise<ProjectShopDrawingFileOutDto> {
    const item = await assertLiveItem(projectId, itemId);
    // When RAB is locked with no change, keep the current version; upload only
    // stores the new file until the user opens a change and switches.
    const makeCurrent = !(await isRabLockedWithoutChange(projectId));
    const out = await files.upload(projectId, itemId, file, {
      ...opts,
      makeCurrent,
    });
    return files.rename(
      projectId,
      out.id,
      shopDrawingOriginalFilename(out.version, item.name, file.originalname),
    );
  }

  async setCurrent(
    projectId: string,
    fileId: string,
  ): Promise<ProjectShopDrawingFileOutDto> {
    await assertCanSwitchShopDrawingCurrent(projectId);
    return files.setCurrent(projectId, fileId);
  }

  async hardDeleteFile(projectId: string, fileId: string): Promise<void> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(fileId)) throw new Error("Invalid file id");
    await assertFilesDeletableWhileLocked(projectId, [fileId]);
    await files.remove(projectId, fileId);
  }

  openDownload(projectId: string, fileId: string) {
    return files.openDownload(projectId, fileId);
  }
}

export const projectShopDrawingService = new ProjectShopDrawingService();
