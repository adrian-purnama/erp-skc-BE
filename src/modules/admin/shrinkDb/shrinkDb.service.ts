import { Types } from "mongoose";
import {
  deleteFileIfExists,
  findFile,
  listFileIds,
} from "../../../buckets/gridfs";
import { listAuditedCollections } from "../../../core/audit/auditedModel";
import type {
  ShrinkDbStatusOutDto,
  ShrinkDbStep,
  ShrinkLiveStatus,
  ShrinkOrphansOutDto,
  PurgeOrphanBlobsOutDto,
  StartShrinkDbOutDto,
} from "../../../dto/shrinkDb.dto";
import { logger } from "../../../logger/logger";
import { ProjectRepo } from "../../../models/project/project.model";
import { ProjectDocumentRepo } from "../../../models/projectDocument/projectDocument.model";
import { ProjectLooseFileRepo } from "../../../models/projectLooseFile/projectLooseFile.model";
import { ProjectShopDrawingDocumentRepo } from "../../../models/projectShopDrawingDocument/projectShopDrawingDocument.model";
import {
  ShrinkRunModel,
  type ShrinkOrphanReport,
  type ShrinkRunResult,
  type ShrinkSection,
} from "../../../models/shrinkRun/shrinkRun.model";

const logSource = "modules/admin/shrinkDb/shrinkDb.service.ts";
const BATCH = 500;
const BUCKET = "project";

export class ShrinkDbConflictError extends Error {
  constructor(message = "A Shrink DB job is already running") {
    super(message);
  }
}

type LiveState = {
  jobId: string | null;
  status: ShrinkLiveStatus;
  section: ShrinkSection | null;
  step: ShrinkDbStep;
  processed: number;
  total: number;
  percent: number;
  excludedProjectIds: string[];
  result: ShrinkRunResult | null;
  errorMessage: string | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
};

let isRunning = false;

let live: LiveState = idleStatus();

function emptyResult(): ShrinkRunResult {
  return {
    auditDeleted: 0,
    documentVersionsSoftDeleted: 0,
    shopDrawingVersionsSoftDeleted: 0,
    blobsPurged: 0,
    errors: [],
  };
}

function idleStatus(): LiveState {
  return {
    jobId: null,
    status: "idle",
    section: null,
    step: "idle",
    processed: 0,
    total: 0,
    percent: 0,
    excludedProjectIds: [],
    result: null,
    errorMessage: null,
    startedAt: null,
    lastHeartbeatAt: null,
  };
}

function setProgress(patch: Partial<LiveState>): void {
  live = { ...live, ...patch };
  if (live.status === "completed") {
    live.percent = 100;
    if (live.total > 0) live.processed = live.total;
    return;
  }
  if (live.total > 0) {
    live.percent = Math.min(
      100,
      Math.round((live.processed / live.total) * 100),
    );
  }
}

async function heartbeat(runId: string): Promise<void> {
  const now = new Date();
  live.lastHeartbeatAt = now.toISOString();
  await ShrinkRunModel.updateOne(
    { _id: runId },
    { $set: { lastHeartbeatAt: now } },
  ).exec();
}

async function assertProjectsExist(ids: string[]): Promise<Types.ObjectId[]> {
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

async function purgeBlobIfUnreferenced(
  gridFsId: Types.ObjectId,
  result: ShrinkRunResult,
): Promise<void> {
  const [docLive, sdLive, looseLive] = await Promise.all([
    ProjectDocumentRepo.model
      .countDocuments({ gridFsId, isDeleted: false })
      .exec(),
    ProjectShopDrawingDocumentRepo.model
      .countDocuments({ gridFsId, isDeleted: false })
      .exec(),
    ProjectLooseFileRepo.model
      .countDocuments({ gridFsId, isDeleted: false })
      .exec(),
  ]);
  if (docLive + sdLive + looseLive > 0) return;
  const exists = await findFile(BUCKET, gridFsId);
  if (!exists) return;
  await deleteFileIfExists(BUCKET, gridFsId);
  result.blobsPurged += 1;
}

/** Append-only audit schemas block Model.deleteMany; use the raw collection. */
async function cleanupAuditCollection(
  AuditModel: ReturnType<typeof listAuditedCollections>[number]["AuditModel"],
  result: ShrinkRunResult,
  onBatch: () => Promise<void>,
): Promise<void> {
  const latest = await AuditModel.aggregate<{ latestId: Types.ObjectId }>([
    { $sort: { at: -1, _id: -1 } },
    { $group: { _id: "$refId", latestId: { $first: "$_id" } } },
  ]).exec();
  const keep = new Set(latest.map((row) => String(row.latestId)));

  let batch: Types.ObjectId[] = [];
  const cursor = AuditModel.collection.find(
    {},
    { projection: { _id: 1 } },
  );
  for await (const doc of cursor) {
    const id = doc._id as Types.ObjectId;
    if (keep.has(String(id))) continue;
    batch.push(id);
    if (batch.length >= BATCH) {
      const del = await AuditModel.collection.deleteMany({
        _id: { $in: batch },
      });
      result.auditDeleted += del.deletedCount ?? 0;
      live.processed += batch.length;
      setProgress({ processed: live.processed });
      batch = [];
      await onBatch();
    }
  }
  if (batch.length > 0) {
    const del = await AuditModel.collection.deleteMany({
      _id: { $in: batch },
    });
    result.auditDeleted += del.deletedCount ?? 0;
    live.processed += batch.length;
    setProgress({ processed: live.processed });
    await onBatch();
  }
}

async function softDeleteNonCurrentVersions(opts: {
  kind: "document" | "shopDrawing";
  excluded: Types.ObjectId[];
  startedBy: Types.ObjectId;
  result: ShrinkRunResult;
  onBatch: () => Promise<void>;
}): Promise<void> {
  const filter: Record<string, unknown> = {
    isCurrent: false,
    isDeleted: false,
  };
  if (opts.excluded.length > 0) {
    filter.projectId = { $nin: opts.excluded };
  }

  const ids: Types.ObjectId[] =
    opts.kind === "document"
      ? (
          await ProjectDocumentRepo.model
            .find(filter)
            .select({ _id: 1 })
            .lean()
            .exec()
        ).map((d) => d._id as Types.ObjectId)
      : (
          await ProjectShopDrawingDocumentRepo.model
            .find(filter)
            .select({ _id: 1 })
            .lean()
            .exec()
        ).map((d) => d._id as Types.ObjectId);

  live.total += ids.length;
  setProgress({ total: live.total });

  const softSet = {
    isDeleted: true,
    isCurrent: false,
    deletedAt: new Date(),
    deletedBy: opts.startedBy,
    deletedReason: "shrink_db" as const,
  };

  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    for (const id of slice) {
      const updated =
        opts.kind === "document"
          ? await ProjectDocumentRepo.findOneAndUpdate(
              { _id: id, isCurrent: false, isDeleted: false },
              { $set: softSet },
            )
          : await ProjectShopDrawingDocumentRepo.findOneAndUpdate(
              { _id: id, isCurrent: false, isDeleted: false },
              { $set: softSet },
            );
      if (!updated) continue;
      if (opts.kind === "document") {
        opts.result.documentVersionsSoftDeleted += 1;
      } else {
        opts.result.shopDrawingVersionsSoftDeleted += 1;
      }
      const gridFsId = updated.gridFsId;
      if (gridFsId instanceof Types.ObjectId || typeof gridFsId === "string") {
        await purgeBlobIfUnreferenced(
          new Types.ObjectId(String(gridFsId)),
          opts.result,
        );
      }
      live.processed += 1;
    }
    setProgress({ processed: live.processed });
    await opts.onBatch();
  }
}

async function runJob(opts: {
  runId: string;
  section: ShrinkSection;
  startedBy: Types.ObjectId;
  excludedProjectIds: string[];
}): Promise<void> {
  const result = emptyResult();
  try {
    const tick = () => heartbeat(opts.runId);

    if (opts.section === "audit") {
      setProgress({
        section: "audit",
        step: "audit",
        processed: 0,
        total: 0,
        percent: 0,
      });
      const collections = listAuditedCollections();
      let auditTotal = 0;
      for (const c of collections) {
        auditTotal += await c.AuditModel.estimatedDocumentCount().exec();
      }
      setProgress({ total: auditTotal });
      for (const c of collections) {
        await cleanupAuditCollection(c.AuditModel, result, tick);
      }
    } else {
      const excluded = await assertProjectsExist(opts.excludedProjectIds);
      setProgress({
        section: "documents",
        step: "documents",
        processed: 0,
        total: 0,
        percent: 0,
      });
      await softDeleteNonCurrentVersions({
        kind: "document",
        excluded,
        startedBy: opts.startedBy,
        result,
        onBatch: tick,
      });

      setProgress({ step: "shopDrawings" });
      await softDeleteNonCurrentVersions({
        kind: "shopDrawing",
        excluded,
        startedBy: opts.startedBy,
        result,
        onBatch: tick,
      });

      setProgress({ step: "finalize" });
      const orphanFinish = await finishShrinkBlobs();
      result.blobsPurged += orphanFinish;
    }

    await ShrinkRunModel.updateOne(
      { _id: opts.runId },
      {
        $set: {
          status: "completed",
          lastHeartbeatAt: new Date(),
          result,
          errorMessage: null,
        },
      },
    ).exec();

    setProgress({
      status: "completed",
      step: "finalize",
      percent: 100,
      result,
      errorMessage: null,
      lastHeartbeatAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    logger.error(message, logSource, "runJob");
    await ShrinkRunModel.updateOne(
      { _id: opts.runId },
      {
        $set: {
          status: "failed",
          lastHeartbeatAt: new Date(),
          result,
          errorMessage: message,
        },
      },
    ).exec();
    setProgress({
      status: "failed",
      result,
      errorMessage: message,
      lastHeartbeatAt: new Date().toISOString(),
    });
  } finally {
    isRunning = false;
  }
}

async function finishShrinkBlobs(): Promise<number> {
  let purged = 0;
  const filter = { isDeleted: true, deletedReason: "shrink_db" as const };
  const [docs, sds] = await Promise.all([
    ProjectDocumentRepo.model
      .find(filter)
      .select({ gridFsId: 1 })
      .lean()
      .exec(),
    ProjectShopDrawingDocumentRepo.model
      .find(filter)
      .select({ gridFsId: 1 })
      .lean()
      .exec(),
  ]);
  const seen = new Set<string>();
  for (const row of [...docs, ...sds]) {
    const id = row.gridFsId as Types.ObjectId;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    const scratch = emptyResult();
    await purgeBlobIfUnreferenced(id, scratch);
    purged += scratch.blobsPurged;
  }
  return purged;
}

async function scopesMissingCurrent(): Promise<
  ShrinkOrphanReport["scopesMissingCurrent"]
> {
  const out: ShrinkOrphanReport["scopesMissingCurrent"] = [];

  const docScopes = await ProjectDocumentRepo.model.aggregate<{
    _id: { projectId: Types.ObjectId; kind: string };
    hasCurrent: number;
  }>([
    {
      $group: {
        _id: { projectId: "$projectId", kind: "$kind" },
        hasCurrent: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$isCurrent", true] },
                  { $ne: ["$isDeleted", true] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    { $match: { hasCurrent: 0 } },
  ]).exec();
  for (const row of docScopes) {
    out.push({
      kind: "document",
      projectId: String(row._id.projectId),
      scope: row._id.kind,
    });
  }

  const sdScopes = await ProjectShopDrawingDocumentRepo.model.aggregate<{
    _id: { projectId: Types.ObjectId; itemId: Types.ObjectId };
    hasCurrent: number;
  }>([
    {
      $group: {
        _id: { projectId: "$projectId", itemId: "$itemId" },
        hasCurrent: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$isCurrent", true] },
                  { $ne: ["$isDeleted", true] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    { $match: { hasCurrent: 0 } },
  ]).exec();
  for (const row of sdScopes) {
    out.push({
      kind: "shopDrawing",
      projectId: String(row._id.projectId),
      scope: String(row._id.itemId),
    });
  }

  return out;
}

async function unmatchedBlobIds(): Promise<string[]> {
  const [docIds, sdIds, looseIds, gridIds] = await Promise.all([
    ProjectDocumentRepo.model.distinct("gridFsId").exec(),
    ProjectShopDrawingDocumentRepo.model.distinct("gridFsId").exec(),
    ProjectLooseFileRepo.model.distinct("gridFsId").exec(),
    listFileIds(BUCKET),
  ]);
  const referenced = new Set(
    [...docIds, ...sdIds, ...looseIds].map((id) => String(id)),
  );
  return gridIds
    .map((id) => String(id))
    .filter((id) => !referenced.has(id));
}

export class ShrinkDbService {
  async start(
    section: ShrinkSection,
    excludedProjectIds: string[],
    startedByUserId: string,
  ): Promise<StartShrinkDbOutDto> {
    if (isRunning) {
      throw new ShrinkDbConflictError();
    }
    isRunning = true;

    try {
      const excluded =
        section === "documents"
          ? await assertProjectsExist(excludedProjectIds)
          : [];
      const startedBy = new Types.ObjectId(startedByUserId);
      const startedAt = new Date();
      const run = await ShrinkRunModel.create({
        startedBy,
        startedAt,
        section,
        excludedProjectIds: excluded,
        status: "running",
        lastHeartbeatAt: startedAt,
        result: null,
        errorMessage: null,
      });

      const jobId = String(run._id);
      live = {
        jobId,
        status: "running",
        section,
        step: section === "audit" ? "audit" : "documents",
        processed: 0,
        total: 0,
        percent: 0,
        excludedProjectIds:
          section === "documents" ? excludedProjectIds : [],
        result: null,
        errorMessage: null,
        startedAt: startedAt.toISOString(),
        lastHeartbeatAt: startedAt.toISOString(),
      };

      void runJob({
        runId: jobId,
        section,
        startedBy,
        excludedProjectIds:
          section === "documents" ? excludedProjectIds : [],
      });

      return { jobId };
    } catch (error) {
      isRunning = false;
      throw error;
    }
  }

  async status(): Promise<ShrinkDbStatusOutDto> {
    if (live.status !== "idle") {
      if (live.status === "completed") {
        return {
          ...live,
          percent: 100,
          processed: live.total > 0 ? live.total : live.processed,
        };
      }
      return { ...live };
    }

    const latest = await ShrinkRunModel.findOne()
      .sort({ startedAt: -1 })
      .lean()
      .exec();
    if (!latest) {
      return idleStatus();
    }

    const mappedStatus: ShrinkLiveStatus =
      latest.status === "running" ? "interrupted" : latest.status;

    return {
      jobId: String(latest._id),
      status: mappedStatus,
      section: latest.section ?? null,
      step: "idle",
      processed: 0,
      total: 0,
      percent: latest.status === "completed" ? 100 : 0,
      excludedProjectIds: (latest.excludedProjectIds ?? []).map(String),
      result: latest.result ?? null,
      errorMessage: latest.errorMessage ?? null,
      startedAt: latest.startedAt?.toISOString() ?? null,
      lastHeartbeatAt: latest.lastHeartbeatAt?.toISOString() ?? null,
      persistedStatus: latest.status,
    };
  }

  async checkOrphans(): Promise<ShrinkOrphansOutDto> {
    const shrinkBlobsPurged = await finishShrinkBlobs();
    const unmatched = await unmatchedBlobIds();
    const missing = await scopesMissingCurrent();
    return {
      shrinkBlobsPurged,
      unmatchedBlobIds: unmatched,
      scopesMissingCurrent: missing,
    };
  }

  async purgeOrphanBlobs(gridFsIds: string[]): Promise<PurgeOrphanBlobsOutDto> {
    const unmatched = new Set(await unmatchedBlobIds());
    let deleted = 0;
    let skipped = 0;
    for (const id of gridFsIds) {
      if (!unmatched.has(id)) {
        skipped += 1;
        continue;
      }
      await deleteFileIfExists(BUCKET, id);
      deleted += 1;
    }
    return { deleted, skipped };
  }

  /** Call once at bootstrap after DB connect. */
  async recoverOnStartup(): Promise<void> {
    const interrupted = await ShrinkRunModel.updateMany(
      { status: "running" },
      {
        $set: {
          status: "interrupted",
          lastHeartbeatAt: new Date(),
          errorMessage: "Server restarted while Shrink DB was running",
        },
      },
    ).exec();
    if ((interrupted.modifiedCount ?? 0) > 0) {
      logger.warn(
        `Marked ${interrupted.modifiedCount} ShrinkRun(s) as interrupted`,
        logSource,
        "recoverOnStartup",
      );
    }
    const purged = await finishShrinkBlobs();
    if (purged > 0) {
      logger.info(
        `Startup orphan finish purged ${purged} GridFS blob(s)`,
        logSource,
        "recoverOnStartup",
      );
    }
  }
}

export const shrinkDbService = new ShrinkDbService();
