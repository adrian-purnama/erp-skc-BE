/**
 * Storage maintenance for project files (ADR-0001: project owns its file models
 * and the `project` GridFS bucket). Used by admin Shrink DB; behaviour moved
 * verbatim from `admin/shrinkDb/shrinkDb.service.ts`.
 */
import { Types } from "mongoose";
import { deleteFileIfExists, findFile, listFileIds } from "../../core/gridfs";
import { ProjectRepo } from "../../models/project.model";
import { ProjectDocumentRepo } from "../../models/projectDocument.model";
import { ProjectLooseFileRepo } from "../../models/projectLooseFile.model";
import { ProjectProductionFileRepo } from "../../models/projectProductionFile.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument.model";

const BUCKET = "project";

/** Versioned project file kinds that Shrink DB compacts. */
export type ProjectFileKind = "document" | "shopDrawing";

export type FileScopeMissingCurrent = {
  kind: ProjectFileKind;
  projectId: string;
  /** Document kind, or shop drawing item id. */
  scope: string;
};

export type ShrinkFileVersionResult = { softDeleted: boolean; blobPurged: boolean };

/** GridFS seam for the `project` bucket; tests stub these. Not exported from index. */
export const projectBlobStore = {
  find: (id: Types.ObjectId | string) => findFile(BUCKET, id),
  delete: (id: Types.ObjectId | string) => deleteFileIfExists(BUCKET, id),
  listIds: () => listFileIds(BUCKET),
};

/** Throws `Unknown project id(s): …` when any id has no project. */
export async function assertProjectsExist(ids: string[]): Promise<Types.ObjectId[]> {
  const oids = ids.map((id) => new Types.ObjectId(id));
  if (oids.length === 0) return [];
  const found = await ProjectRepo.model
    .find({ _id: { $in: oids } })
    .select({ _id: 1 })
    .lean()
    .exec();
  if (found.length !== oids.length) {
    const have = new Set(found.map((p) => String(p._id)));
    const missing = ids.filter((id) => !have.has(id));
    throw new Error(`Unknown project id(s): ${missing.join(", ")}`);
  }
  return oids;
}

/** Ids of live, non-current versions of `kind`, outside the excluded projects. */
export async function listNonCurrentFileVersionIds(
  kind: ProjectFileKind,
  excludedProjectIds: Types.ObjectId[],
): Promise<Types.ObjectId[]> {
  const filter: Record<string, unknown> = { isCurrent: false, isDeleted: false };
  if (excludedProjectIds.length > 0) {
    filter.projectId = { $nin: excludedProjectIds };
  }
  const rows =
    kind === "document"
      ? await ProjectDocumentRepo.model.find(filter).select({ _id: 1 }).lean().exec()
      : await ProjectShopDrawingDocumentRepo.model.find(filter).select({ _id: 1 }).lean().exec();
  return rows.map((d) => d._id as Types.ObjectId);
}

/** Deletes the blob when no live file row of any kind references it. */
async function purgeBlobIfUnreferenced(gridFsId: Types.ObjectId): Promise<boolean> {
  const [docLive, sdLive, looseLive, productionLive] = await Promise.all([
    ProjectDocumentRepo.model.countDocuments({ gridFsId, isDeleted: false }).exec(),
    ProjectShopDrawingDocumentRepo.model.countDocuments({ gridFsId, isDeleted: false }).exec(),
    ProjectLooseFileRepo.model.countDocuments({ gridFsId, isDeleted: false }).exec(),
    ProjectProductionFileRepo.model.countDocuments({ gridFsId, isDeleted: false }).exec(),
  ]);
  if (docLive + sdLive + looseLive + productionLive > 0) return false;
  const exists = await projectBlobStore.find(gridFsId);
  if (!exists) return false;
  await projectBlobStore.delete(gridFsId);
  return true;
}

/**
 * Soft-deletes one non-current version (audited, reason `shrink_db`) and purges
 * its blob if nothing live references it. No-op when the row is no longer a
 * live non-current version.
 */
export async function shrinkFileVersion(
  kind: ProjectFileKind,
  id: Types.ObjectId,
  deletedBy: Types.ObjectId,
): Promise<ShrinkFileVersionResult> {
  const filter = { _id: id, isCurrent: false, isDeleted: false };
  const update = {
    $set: {
      isDeleted: true,
      isCurrent: false,
      deletedAt: new Date(),
      deletedBy,
      deletedReason: "shrink_db" as const,
    },
  };
  const updated =
    kind === "document"
      ? await ProjectDocumentRepo.findOneAndUpdate(filter, update)
      : await ProjectShopDrawingDocumentRepo.findOneAndUpdate(filter, update);
  if (!updated) return { softDeleted: false, blobPurged: false };

  const gridFsId = updated.gridFsId;
  let blobPurged = false;
  if (gridFsId instanceof Types.ObjectId || typeof gridFsId === "string") {
    blobPurged = await purgeBlobIfUnreferenced(new Types.ObjectId(String(gridFsId)));
  }
  return { softDeleted: true, blobPurged };
}

/** Finishes interrupted runs: purges blobs of shrink-deleted rows. Returns the count purged. */
export async function purgeShrinkDeletedBlobs(): Promise<number> {
  let purged = 0;
  const filter = { isDeleted: true, deletedReason: "shrink_db" as const };
  const [docs, sds] = await Promise.all([
    ProjectDocumentRepo.model.find(filter).select({ gridFsId: 1 }).lean().exec(),
    ProjectShopDrawingDocumentRepo.model.find(filter).select({ gridFsId: 1 }).lean().exec(),
  ]);
  const seen = new Set<string>();
  for (const row of [...docs, ...sds]) {
    const id = row.gridFsId as Types.ObjectId;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (await purgeBlobIfUnreferenced(id)) purged += 1;
  }
  return purged;
}

/** Bucket blob ids that no project file row (deleted or not) references. */
export async function listUnreferencedProjectBlobIds(): Promise<string[]> {
  const [docIds, sdIds, looseIds, productionIds, gridIds] = await Promise.all([
    ProjectDocumentRepo.model.distinct("gridFsId").exec(),
    ProjectShopDrawingDocumentRepo.model.distinct("gridFsId").exec(),
    ProjectLooseFileRepo.model.distinct("gridFsId").exec(),
    ProjectProductionFileRepo.model.distinct("gridFsId").exec(),
    projectBlobStore.listIds(),
  ]);
  const referenced = new Set(
    [...docIds, ...sdIds, ...looseIds, ...productionIds].map((id) => String(id)),
  );
  return gridIds.map((id) => String(id)).filter((id) => !referenced.has(id));
}

/** Deletes the given blobs that are still unreferenced; the rest are skipped. */
export async function purgeUnreferencedProjectBlobs(
  gridFsIds: string[],
): Promise<{ deleted: number; skipped: number }> {
  const unmatched = new Set(await listUnreferencedProjectBlobIds());
  let deleted = 0;
  let skipped = 0;
  for (const id of gridFsIds) {
    if (!unmatched.has(id)) {
      skipped += 1;
      continue;
    }
    await projectBlobStore.delete(id);
    deleted += 1;
  }
  return { deleted, skipped };
}

const HAS_LIVE_CURRENT = {
  $sum: {
    $cond: [{ $and: [{ $eq: ["$isCurrent", true] }, { $ne: ["$isDeleted", true] }] }, 1, 0],
  },
};

/** Document kinds / shop drawing items whose versions have no live current one. */
export async function listFileScopesMissingCurrent(): Promise<FileScopeMissingCurrent[]> {
  const out: FileScopeMissingCurrent[] = [];

  const docScopes = await ProjectDocumentRepo.model
    .aggregate<{ _id: { projectId: Types.ObjectId; kind: string }; hasCurrent: number }>([
      { $group: { _id: { projectId: "$projectId", kind: "$kind" }, hasCurrent: HAS_LIVE_CURRENT } },
      { $match: { hasCurrent: 0 } },
    ])
    .exec();
  for (const row of docScopes) {
    out.push({ kind: "document", projectId: String(row._id.projectId), scope: row._id.kind });
  }

  const sdScopes = await ProjectShopDrawingDocumentRepo.model
    .aggregate<{ _id: { projectId: Types.ObjectId; itemId: Types.ObjectId }; hasCurrent: number }>([
      { $group: { _id: { projectId: "$projectId", itemId: "$itemId" }, hasCurrent: HAS_LIVE_CURRENT } },
      { $match: { hasCurrent: 0 } },
    ])
    .exec();
  for (const row of sdScopes) {
    out.push({
      kind: "shopDrawing",
      projectId: String(row._id.projectId),
      scope: String(row._id.itemId),
    });
  }

  return out;
}
