import { createHash } from "crypto";
import { Types, type UpdateQuery } from "mongoose";
import { deleteFileIfExists, openDownload } from "../../buckets/gridfs";
import type { AuditedRepo } from "../../core/audit/auditedModel";
import { als, withTx } from "../../core/audit/context";
import type { ProjectDocumentKind } from "../../models/projectDocument/projectDocument.model";
import { userEmailsById } from "../../utils/shared";
import {
  assertProjectExists,
  openBlob,
  uploadDedupedBlob,
} from "./projectShared";

type Filter = Record<string, unknown>;

/** Lean row shared by project documents (scoped by `kind`) and shopDrawing files (scoped by `itemId`). */
export type VersionedFileDoc = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  kind?: ProjectDocumentKind;
  itemId?: Types.ObjectId;
  version: number;
  isCurrent: boolean;
  gridFsId: Types.ObjectId;
  contentHash?: string | null;
  forceDifferent?: boolean;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy?: Types.ObjectId | null;
  isDeleted?: boolean;
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  createdAt?: Date;
};

export type VersionedFileExtras = {
  linked?: boolean;
  sameAsVersion?: number | null;
  hasBoq?: boolean;
};

export type VersionedFileConfig<T, TOut> = {
  repo: AuditedRepo<T>;
  /** Field that groups versions: `kind` (documents) or `itemId` (shopDrawing). */
  scopeField: "kind" | "itemId";
  noun: "document" | "file";
  toOut(
    doc: VersionedFileDoc,
    names: Map<string, string>,
    extras?: VersionedFileExtras,
  ): TOut;
  /** Scope-specific upload checks (run after the project exists). */
  assertUpload(
    projectId: string,
    scope: string,
    file: Express.Multer.File,
  ): Promise<void> | void;
  /** Optional guard that the scope still exists (e.g. shopDrawing item not deleted). */
  assertScopeLive?(projectId: string, scope: string): Promise<unknown>;
  /** Presence = hard delete (row removed); absence = soft delete. */
  hardDelete?: {
    beforeDelete(projectId: string, id: string): Promise<void>;
  };
};

export function userNamesById(
  ids: string[],
): Promise<Map<string, string>> {
  return userEmailsById(ids);
}

export function sameAsVersionFor(
  doc: VersionedFileDoc,
  siblings: VersionedFileDoc[],
): number | null {
  if (doc.forceDifferent) return null;
  if (!doc.contentHash) return null;
  let earliest: number | null = null;
  for (const other of siblings) {
    if (String(other._id) === String(doc._id)) continue;
    if (other.contentHash !== doc.contentHash) continue;
    if (earliest === null || other.version < earliest) {
      earliest = other.version;
    }
  }
  return earliest;
}

export class VersionedProjectFileService<T, TOut> {
  constructor(private readonly cfg: VersionedFileConfig<T, TOut>) {}

  private get cap(): string {
    return this.cfg.noun === "document" ? "Document" : "File";
  }

  private scopeOf(doc: VersionedFileDoc): string {
    return String(doc[this.cfg.scopeField]);
  }

  private scopeFilter(projectId: string, scope: string): Filter {
    return { projectId, [this.cfg.scopeField]: scope };
  }

  private async findMany(
    filter: Filter,
    sort?: Record<string, 1 | -1>,
  ): Promise<VersionedFileDoc[]> {
    const q = this.cfg.repo.model.find(filter);
    const rows = await (sort ? q.sort(sort) : q).lean().exec();
    return rows as unknown as VersionedFileDoc[];
  }

  private async findOne(filter: Filter): Promise<VersionedFileDoc | null> {
    const row = await this.cfg.repo.model.findOne(filter).lean().exec();
    return row as unknown as VersionedFileDoc | null;
  }

  private update(id: string, set: Filter) {
    return this.cfg.repo.findByIdAndUpdate(id, {
      $set: set,
    } as UpdateQuery<T>);
  }

  toOut(
    doc: VersionedFileDoc,
    names: Map<string, string>,
    extras?: VersionedFileExtras,
  ): TOut {
    return this.cfg.toOut(doc, names, extras);
  }

  /** Fetch rows plus uploader/deleter display names. */
  async list(
    filter: Filter,
    sort?: Record<string, 1 | -1>,
  ): Promise<{ docs: VersionedFileDoc[]; names: Map<string, string> }> {
    const docs = await this.findMany(filter, sort);
    const names = await userNamesById(
      docs.flatMap((d) =>
        [d.uploadedBy, d.deletedBy].filter(Boolean).map(String),
      ),
    );
    return { docs, names };
  }

  /** Map one row to its out DTO, resolving names and `sameAsVersion`. */
  async present(
    doc: VersionedFileDoc,
    extras: VersionedFileExtras = {},
  ): Promise<TOut> {
    const names = await userNamesById(
      [doc.uploadedBy, doc.deletedBy].filter(Boolean).map(String),
    );
    const siblings = await this.findMany(
      this.scopeFilter(String(doc.projectId), this.scopeOf(doc)),
    );
    return this.cfg.toOut(doc, names, {
      ...extras,
      sameAsVersion: sameAsVersionFor(doc, siblings),
    });
  }

  async upload(
    projectId: string,
    scope: string,
    file: Express.Multer.File,
    opts: { force?: boolean; uploadedByUserId?: string } = {},
  ): Promise<TOut> {
    const { repo, scopeField } = this.cfg;
    await assertProjectExists(projectId);
    await this.cfg.assertUpload(projectId, scope, file);

    const contentHash = createHash("sha256").update(file.buffer).digest("hex");
    const actorId =
      opts.uploadedByUserId || als.getStore()?.userId || undefined;
    const contentType = file.mimetype || "application/octet-stream";

    const { gridFsId, linked, createdNewBlob } = await uploadDedupedBlob({
      buffer: file.buffer,
      filename: file.originalname,
      contentType,
      contentHash,
      force: opts.force,
      metadata: {
        projectId,
        [scopeField]: scope,
        originalFilename: file.originalname,
        contentHash,
      },
      findExistingIds: async () => {
        const candidates = await this.findMany(
          { contentHash },
          { createdAt: -1 },
        );
        return candidates.map((c) => c.gridFsId);
      },
    });

    try {
      const scopeFilter = this.scopeFilter(projectId, scope);
      const created = await withTx(async () => {
        const previous = await this.findOne({
          ...scopeFilter,
          isCurrent: true,
          isDeleted: false,
        });
        if (previous) {
          await this.update(String(previous._id), { isCurrent: false });
        }

        const latest = (await repo.model
          .findOne(scopeFilter)
          .sort({ version: -1 })
          .select({ version: 1 })
          .lean()
          .exec()) as unknown as { version?: number } | null;

        return repo.create({
          projectId: new Types.ObjectId(projectId),
          [scopeField]:
            scopeField === "itemId" ? new Types.ObjectId(scope) : scope,
          version: (latest?.version ?? 0) + 1,
          isCurrent: true,
          gridFsId,
          contentHash,
          forceDifferent: opts.force === true,
          originalFilename: file.originalname,
          contentType,
          sizeBytes: file.size,
          uploadedBy: actorId ? new Types.ObjectId(actorId) : undefined,
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
        } as unknown as Partial<T>);
      });

      const fresh = await this.findOne({ _id: created._id });
      if (!fresh) throw new Error(`${this.cap} created but not found`);
      return await this.present(fresh, { linked: linked || undefined });
    } catch (error) {
      if (createdNewBlob) {
        await deleteFileIfExists("project", gridFsId);
      }
      throw error;
    }
  }

  async rename(
    projectId: string,
    id: string,
    originalFilename: string,
  ): Promise<TOut> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(id)) {
      throw new Error(`Invalid ${this.cfg.noun} id`);
    }

    const existing = await this.findOne({ _id: id, projectId });
    if (!existing) throw new Error(`${this.cap} not found`);
    if (existing.isDeleted) {
      throw new Error(`Cannot rename a deleted ${this.cfg.noun}`);
    }

    const updated = await this.update(id, { originalFilename });
    if (!updated) throw new Error(`${this.cap} not found`);

    const fresh = await this.findOne({ _id: id });
    if (!fresh) throw new Error(`${this.cap} not found`);
    return this.present(fresh);
  }

  async setCurrent(projectId: string, id: string): Promise<TOut> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(id)) {
      throw new Error(`Invalid ${this.cfg.noun} id`);
    }

    const target = await this.findOne({ _id: id, projectId });
    if (!target) throw new Error(`${this.cap} not found`);
    if (target.isDeleted) throw new Error("Cannot use a deleted version");
    await this.cfg.assertScopeLive?.(projectId, this.scopeOf(target));

    if (!target.isCurrent) {
      await withTx(async () => {
        const previous = await this.findOne({
          ...this.scopeFilter(projectId, this.scopeOf(target)),
          isCurrent: true,
          isDeleted: false,
        });
        if (previous && String(previous._id) !== String(target._id)) {
          await this.update(String(previous._id), { isCurrent: false });
        }
        const updated = await this.update(id, { isCurrent: true });
        if (!updated) throw new Error(`${this.cap} not found`);
      });
    }

    const fresh = await this.findOne({ _id: id });
    if (!fresh) throw new Error(`${this.cap} not found`);
    return this.present(fresh);
  }

  async openDownload(
    projectId: string,
    id: string,
  ): Promise<{
    stream: ReturnType<typeof openDownload>;
    filename: string;
    contentType: string;
  }> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(id)) {
      throw new Error(`Invalid ${this.cfg.noun} id`);
    }

    const doc = await this.findOne({ _id: id, projectId });
    if (!doc) throw new Error(`${this.cap} not found`);
    if (doc.isDeleted) throw new Error(`${this.cap} deleted`);
    await this.cfg.assertScopeLive?.(projectId, this.scopeOf(doc));

    return openBlob(doc.gridFsId, doc.originalFilename, doc.contentType);
  }

  /**
   * Soft mode: marks the version deleted (who/when). Hard mode: removes the row
   * (after `hardDelete.beforeDelete`). Either way the latest remaining version
   * is promoted to current, and the GridFS blob is purged once unreferenced.
   * Returns the deleted row (reloaded in soft mode, pre-delete snapshot in hard mode).
   */
  async remove(
    projectId: string,
    id: string,
    deletedByUserId?: string,
  ): Promise<VersionedFileDoc> {
    const { repo, hardDelete } = this.cfg;
    if (!Types.ObjectId.isValid(id)) {
      throw new Error(`Invalid ${this.cfg.noun} id`);
    }

    const existing = await this.findOne({ _id: id, projectId });
    if (!existing) throw new Error(`${this.cap} not found`);
    if (!hardDelete && existing.isDeleted) {
      throw new Error(`${this.cap} already deleted`);
    }

    const actorId =
      deletedByUserId || als.getStore()?.userId || undefined;
    const gridFsId = existing.gridFsId;

    await withTx(async () => {
      if (hardDelete) {
        await hardDelete.beforeDelete(projectId, id);
        const removed = await repo.deleteOne({ _id: id, projectId });
        if (!removed) throw new Error(`${this.cap} not found`);
      } else {
        const row = await this.update(id, {
          isDeleted: true,
          isCurrent: false,
          deletedAt: new Date(),
          deletedBy: actorId ? new Types.ObjectId(actorId) : null,
        });
        if (!row) throw new Error(`${this.cap} not found`);
      }

      if (existing.isCurrent) {
        const next = (await repo.model
          .findOne({
            ...this.scopeFilter(projectId, this.scopeOf(existing)),
            ...(hardDelete ? {} : { isDeleted: false }),
            _id: { $ne: existing._id },
          })
          .sort({ version: -1 })
          .lean()
          .exec()) as unknown as VersionedFileDoc | null;
        if (next && !next.isCurrent) {
          await this.update(String(next._id), { isCurrent: true });
        }
      }
    });

    // Keep the blob while another (live) version still references it.
    const liveRefs = await repo.model
      .countDocuments(hardDelete ? { gridFsId } : { gridFsId, isDeleted: false })
      .exec();
    if (liveRefs === 0) {
      await deleteFileIfExists("project", gridFsId);
    }

    if (hardDelete) return existing;
    const fresh = await this.findOne({ _id: id });
    if (!fresh) throw new Error(`${this.cap} not found`);
    return fresh;
  }
}
