import { extname } from "path";
import { Types } from "mongoose";
import { als } from "../../core/audit/context";
import type {
  ProjectShopDrawingFileOutDto,
  ProjectShopDrawingItemOutDto,
} from "../../dto/projectShopDrawing.dto";
import { ProjectRepo } from "../../models/project/project.model";
import { ProjectProductionFileRepo } from "../../models/projectProductionFile/projectProductionFile.model";
import { ProjectShopDrawingBoqRepo } from "../../models/projectShopDrawingBoq/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument/projectShopDrawingDocument.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem/projectShopDrawingItem.model";
import {
  assertShopDrawingFile,
  type ShopDrawingItemInDto,
} from "../../validation/projectShopDrawing";
import { projectRabChangeService } from "./projectRabChange.service";
import { rabLockState } from "./projectRabLock";
import { purgeShopDrawingItem } from "./projectShopDrawingPurge";
import { assertProjectExists, shopDrawingItemLabel } from "./projectShared";
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
  code?: string;
  name: string;
  descriptions?: string[];
  dimension?: string;
  category?: string | null;
  mockupApproveDate?: string | null;
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

type ItemMetaOut = Pick<
  ProjectShopDrawingItemOutDto,
  | "id"
  | "code"
  | "name"
  | "label"
  | "descriptions"
  | "dimension"
  | "category"
  | "mockupApproveDate"
>;

function toItemMeta(item: LeanItem): ItemMetaOut {
  return {
    id: String(item._id),
    code: item.code ?? "",
    name: item.name,
    label: shopDrawingItemLabel(item),
    descriptions: item.descriptions ?? [],
    dimension: item.dimension ?? "",
    category: item.category ?? null,
    mockupApproveDate: item.mockupApproveDate?.trim()
      ? item.mockupApproveDate.trim()
      : null,
  };
}

/** Kode is the item's identity within a project. */
async function assertCodeFree(
  projectId: string,
  code: string,
  exceptItemId?: string,
): Promise<void> {
  const dup = await ProjectShopDrawingItemRepo.model
    .findOne({
      projectId,
      code,
      isDeleted: false,
      ...(exceptItemId ? { _id: { $ne: exceptItemId } } : {}),
    })
    .select({ _id: 1 })
    .lean()
    .exec();
  if (dup) throw new Error(`Kode ${code} is already used by another item`);
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

/** File Produksi: same versioning as SD files, but no BOQ and no RAB lock. */
const productionFiles = new VersionedProjectFileService({
  repo: ProjectProductionFileRepo,
  scopeField: "itemId",
  noun: "file",
  toOut: toFileOut,
  assertUpload: async (projectId, itemId, file) => {
    await assertLiveItem(projectId, itemId);
    assertShopDrawingFile(file);
  },
  assertScopeLive: assertLiveItem,
  hardDelete: { beforeDelete: async () => {} },
});

/** After release, production must always have a current File Produksi. */
async function assertProductionFileDeletable(
  projectId: string,
  fileId: string,
): Promise<void> {
  const project = await ProjectRepo.model
    .findById(projectId)
    .select({ productionReleasedAt: 1 })
    .lean()
    .exec();
  if (!project?.productionReleasedAt) return;
  const file = await ProjectProductionFileRepo.model
    .findOne({ _id: fileId, projectId })
    .select({ isCurrent: 1 })
    .lean()
    .exec();
  if (file?.isCurrent) {
    throw new Error(
      "Project is released to production: upload or select another version before deleting the current File Produksi",
    );
  }
}

export class ProjectShopDrawingService {
  async listByProject(projectId: string): Promise<ProjectShopDrawingItemOutDto[]> {
    await assertProjectExists(projectId);

    const items = (await ProjectShopDrawingItemRepo.model
      .find({ projectId, isDeleted: false })
      .sort({ code: 1, name: 1 })
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

    const production = await productionFiles.list(
      { projectId, isDeleted: { $ne: true } },
      { version: -1 },
    );
    const { change } = await rabLockState(projectId);
    const removedInChange = new Set(
      (change?.removedItemIds ?? []).map(String),
    );

    return items.map((item) => {
      const itemId = String(item._id);
      const itemProduction = production.docs.filter(
        (d) => String(d.itemId) === itemId,
      );
      const productionVersions = itemProduction.map((d) =>
        toFileOut(d, production.names, {
          sameAsVersion: sameAsVersionFor(d, itemProduction),
        }),
      );
      const productionCurrent =
        productionVersions.find((v) => v.isCurrent && !v.isDeleted) ?? null;
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
        ...toItemMeta(item),
        current,
        versions,
        productionCurrent,
        productionVersions,
        removedInChange: removedInChange.has(itemId),
      };
    });
  }

  async createItem(
    projectId: string,
    input: ShopDrawingItemInDto,
    createdByUserId?: string,
  ): Promise<ProjectShopDrawingItemOutDto> {
    await assertProjectExists(projectId);
    const actorId =
      createdByUserId || als.getStore()?.userId || undefined;
    await assertCodeFree(projectId, input.code);

    const created = (await ProjectShopDrawingItemRepo.create({
      projectId: new Types.ObjectId(projectId),
      code: input.code,
      name: input.name,
      descriptions: input.descriptions,
      dimension: input.dimension,
      category: input.category,
      mockupApproveDate: input.mockupApproveDate,
      createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
    })) as unknown as LeanItem;

    return {
      ...toItemMeta(created),
      current: null,
      versions: [],
      productionCurrent: null,
      productionVersions: [],
      removedInChange: false,
    };
  }

  /** Edit kode, name, keterangan, ukuran and category; file names follow the label. */
  async updateItem(
    projectId: string,
    itemId: string,
    input: ShopDrawingItemInDto,
  ): Promise<ProjectShopDrawingItemOutDto> {
    await assertProjectExists(projectId);
    const existing = await assertLiveItem(projectId, itemId);
    await assertCodeFree(projectId, input.code, itemId);

    const updated = await ProjectShopDrawingItemRepo.findByIdAndUpdate(itemId, {
      $set: {
        code: input.code,
        name: input.name,
        descriptions: input.descriptions,
        dimension: input.dimension,
        category: input.category,
        mockupApproveDate: input.mockupApproveDate,
      },
    });
    if (!updated) throw new Error("Item not found");

    const label = shopDrawingItemLabel(input);
    if (shopDrawingItemLabel(existing) !== label) {
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
          shopDrawingOriginalFilename(doc.version, label, doc.originalFilename),
        );
      }
    }

    const list = await this.listByProject(projectId);
    const row = list.find((i) => i.id === itemId);
    if (!row) throw new Error("Item not found");
    return row;
  }

  /**
   * RAB not locked: delete now. RAB locked: the item is removed inside the open
   * change and deleted on commit (discard keeps it).
   */
  async hardDeleteItem(
    projectId: string,
    itemId: string,
  ): Promise<{ removedInChange: boolean }> {
    await assertProjectExists(projectId);
    await assertLiveItem(projectId, itemId);

    const { locked, change } = await rabLockState(projectId);
    if (locked) {
      if (!change) {
        throw new Error(
          "RAB is locked: open a RAB change to remove this item",
        );
      }
      await projectRabChangeService.markItemRemovedInDraft(projectId, itemId);
      return { removedInChange: true };
    }

    await purgeShopDrawingItem(projectId, itemId);
    return { removedInChange: false };
  }

  /** Undo "remove" on an item inside the open RAB change. */
  async restoreItem(projectId: string, itemId: string): Promise<void> {
    await assertProjectExists(projectId);
    await assertLiveItem(projectId, itemId);
    await projectRabChangeService.restoreItemInDraft(projectId, itemId);
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
      shopDrawingOriginalFilename(
        out.version,
        shopDrawingItemLabel(item),
        file.originalname,
      ),
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

  async uploadProductionFile(
    projectId: string,
    itemId: string,
    file: Express.Multer.File,
    opts: { force?: boolean; uploadedByUserId?: string } = {},
  ): Promise<ProjectShopDrawingFileOutDto> {
    await assertLiveItem(projectId, itemId);
    return productionFiles.upload(projectId, itemId, file, opts);
  }

  setCurrentProductionFile(
    projectId: string,
    fileId: string,
  ): Promise<ProjectShopDrawingFileOutDto> {
    return productionFiles.setCurrent(projectId, fileId);
  }

  async deleteProductionFile(projectId: string, fileId: string): Promise<void> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(fileId)) throw new Error("Invalid file id");
    await assertProductionFileDeletable(projectId, fileId);
    await productionFiles.remove(projectId, fileId);
  }

  openProductionDownload(projectId: string, fileId: string) {
    return productionFiles.openDownload(projectId, fileId);
  }
}

export const projectShopDrawingService = new ProjectShopDrawingService();
