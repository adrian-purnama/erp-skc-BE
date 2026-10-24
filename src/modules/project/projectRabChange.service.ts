import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import type {
  OpenProjectRabChangeInDto,
  ProjectRabChangeBoqDiffOutDto,
  ProjectRabChangeDetailOutDto,
  ProjectRabChangeLineDiffOutDto,
  ProjectRabChangeSummaryOutDto,
  ProjectRabChangeVersionDiffOutDto,
} from "../../dto/projectRabChange.dto";
import type {
  ProjectRabLineOutDto,
  ProjectRabUserRefOutDto,
} from "../../dto/projectRab.dto";
import {
  ProjectRabChangeRepo,
  type ProjectRabChangeBoqSnapshot,
  type ProjectRabChangeCurrentFile,
  type ProjectRabChangeInterface,
} from "../../models/projectRabChange/projectRabChange.model";
import {
  ProjectRabRepo,
  type ProjectRabLine,
} from "../../models/projectRab/projectRab.model";
import { ProjectShopDrawingBoqRepo } from "../../models/projectShopDrawingBoq/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument/projectShopDrawingDocument.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem/projectShopDrawingItem.model";
import { itemMasterService } from "../itemMaster/itemMaster.service";
import { itemUomService } from "../itemMaster/itemUom.service";
import { fileVersionsById, liveCurrentFiles } from "./projectCurrentFiles";
import {
  diffBoqFiles,
  diffBoqMaterialContributions,
  diffCurrentFiles,
  diffRabLines,
  filterCountedBoqs,
  sumLineTotals,
  syncRabLinesFromBoqs,
  type LeanBoqDoc,
} from "./projectRabChange.planner";
import { assertProjectExists } from "./projectShared";
import { userEmailsById } from "../../utils/shared";
import { assertAllLinesPriced, computeLineTotal } from "./projectRab.planner";

export { syncRabLinesFromBoqs } from "./projectRabChange.planner";

type LeanChange = ProjectRabChangeInterface & { _id: Types.ObjectId };

const DRAFT_GONE = "The change is no longer open (it was committed or discarded)";

function stampAddedLinesOnCommit(
  baseline: ProjectRabLine[],
  next: ProjectRabLine[],
  userId: string,
  reason: string,
  now: Date,
): ProjectRabLine[] {
  const addedKeys = new Set(
    diffRabLines(baseline, next)
      .filter((d) => d.kind === "added")
      .map((d) => d.key),
  );
  if (addedKeys.size === 0) return next;
  const by = new Types.ObjectId(userId);
  const because = reason.trim();
  return next.map((line) => {
    if (!addedKeys.has(line.key)) return line;
    return {
      ...line,
      origin: line.origin === "labour" ? "labour" : "append",
      addedAt: now,
      addedBy: by,
      ...(because ? { addReason: because } : {}),
    };
  });
}

function cloneBoqSnap(boq: LeanBoqDoc): ProjectRabChangeBoqSnapshot {
  return {
    shopDrawingItemId: boq.shopDrawingItemId,
    shopDrawingFileId: boq.shopDrawingFileId,
    makeQty: boq.makeQty,
    main: boq.main ?? { parts: [], assembly: { lines: [] } },
    lighting: boq.lighting ?? { lines: [] },
    mounting: boq.mounting ?? { type: "mounted", lines: [] },
    other: boq.other ?? { lines: [] },
  };
}

function cloneLines(lines: ProjectRabLine[]): ProjectRabLine[] {
  return lines.map((l) => ({ ...l }));
}

function boqContentKey(boq: LeanBoqDoc): string {
  return JSON.stringify({
    q: boq.makeQty,
    main: boq.main,
    lighting: boq.lighting,
    mounting: boq.mounting,
    other: boq.other,
  });
}

function baselineLinesOf(doc: LeanChange): ProjectRabLine[] {
  if (Array.isArray(doc.baselineRabLines) && doc.baselineRabLines.length > 0) {
    return doc.baselineRabLines;
  }
  // Legacy drafts opened before baseline fields existed
  return [];
}

function baselineBoqsOf(doc: LeanChange): ProjectRabChangeBoqSnapshot[] {
  if (Array.isArray(doc.baselineBoqs)) return doc.baselineBoqs;
  return [];
}

export class ProjectRabChangeService {
  async findOpenDraft(projectId: string): Promise<LeanChange | null> {
    return (await ProjectRabChangeRepo.model
      .findOne({
        projectId: new Types.ObjectId(projectId),
        status: "draft",
      })
      .lean()
      .exec()) as LeanChange | null;
  }

  async open(
    projectId: string,
    userId: string,
    input: OpenProjectRabChangeInDto,
  ): Promise<ProjectRabChangeSummaryOutDto> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user id");
    }
    const reason = input.reason.trim();
    if (!reason) throw new Error("reason is required");

    const projectOid = new Types.ObjectId(projectId);
    const rab = await ProjectRabRepo.model
      .findOne({ projectId: projectOid })
      .lean()
      .exec();
    if (!rab || rab.status !== "locked") {
      throw new Error("RAB must be locked before opening a change");
    }

    const existing = await this.findOpenDraft(projectId);
    if (existing) {
      throw new Error("A draft change is already open for this project");
    }

    const [liveBoqs, currentFiles] = await Promise.all([
      ProjectShopDrawingBoqRepo.model
        .find({ projectId: projectOid })
        .lean()
        .exec() as Promise<LeanBoqDoc[]>,
      liveCurrentFiles(projectId),
    ]);

    const boqSnaps = liveBoqs.map(cloneBoqSnap);
    const lineSnaps = cloneLines(rab.lines as ProjectRabLine[]);
    const now = new Date();
    const created = await ProjectRabChangeRepo.create({
      projectId: projectOid,
      reason,
      status: "draft",
      openedBy: new Types.ObjectId(userId),
      openedAt: now,
      baselineBoqs: boqSnaps,
      baselineRabLines: lineSnaps,
      baselineCurrentFiles: currentFiles,
      boqs: boqSnaps.map(cloneBoqSnap),
      rabLines: cloneLines(lineSnaps),
    });

    return this.toSummary(
      created as unknown as LeanChange,
      await userEmailsById([userId]),
    );
  }

  async list(projectId: string): Promise<ProjectRabChangeSummaryOutDto[]> {
    await assertProjectExists(projectId);
    const rows = (await ProjectRabChangeRepo.model
      .find({ projectId: new Types.ObjectId(projectId) })
      .sort({ openedAt: -1 })
      .lean()
      .exec()) as LeanChange[];
    const userIds = [
      ...new Set(
        rows.flatMap((r) =>
          [
            String(r.openedBy),
            r.committedBy ? String(r.committedBy) : null,
          ].filter((id): id is string => Boolean(id)),
        ),
      ),
    ];
    const names = await userEmailsById(userIds);
    return rows.map((r) => this.toSummary(r, names));
  }

  async getCurrent(
    projectId: string,
  ): Promise<ProjectRabChangeDetailOutDto | null> {
    await assertProjectExists(projectId);
    const draft = await this.findOpenDraft(projectId);
    if (!draft) return null;
    return this.toDetail(draft);
  }

  async getById(
    projectId: string,
    changeId: string,
  ): Promise<ProjectRabChangeDetailOutDto> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(changeId)) {
      throw new Error("Invalid change id");
    }
    const doc = (await ProjectRabChangeRepo.model
      .findOne({
        _id: new Types.ObjectId(changeId),
        projectId: new Types.ObjectId(projectId),
      })
      .lean()
      .exec()) as LeanChange | null;
    if (!doc) throw new Error("Change not found");
    return this.toDetail(doc);
  }

  /** Build detail/diff for an already-loaded change document. */
  async describe(doc: LeanChange): Promise<ProjectRabChangeDetailOutDto> {
    return this.toDetail(doc);
  }

  /**
   * Drop the draft and put back the file versions that were current when it
   * was opened, so nothing done inside the change survives on live data.
   */
  async discard(
    projectId: string,
    userId: string,
  ): Promise<ProjectRabChangeSummaryOutDto> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user id");
    }
    const draft = await this.findOpenDraft(projectId);
    if (!draft) throw new Error("No open draft change");

    const updated = await withTx(async () => {
      if (draft.baselineCurrentFiles) {
        await this.restoreCurrentFiles(projectId, draft.baselineCurrentFiles);
      }
      const row = (await ProjectRabChangeRepo.findOneAndUpdate(
        { _id: draft._id, status: "draft" },
        { $set: { status: "discarded" } },
      )) as LeanChange | null;
      if (!row) throw new Error(DRAFT_GONE);
      return row;
    });
    const names = await userEmailsById([String(updated.openedBy)]);
    return this.toSummary(updated, names);
  }

  async commit(
    projectId: string,
    userId: string,
  ): Promise<ProjectRabChangeSummaryOutDto> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user id");
    }
    const draft = await this.findOpenDraft(projectId);
    if (!draft) throw new Error("No open draft change");

    const projectOid = new Types.ObjectId(projectId);
    const rab = await ProjectRabRepo.model
      .findOne({ projectId: projectOid })
      .lean()
      .exec();
    if (!rab || rab.status !== "locked") {
      throw new Error("RAB must be locked to commit a change");
    }

    const currentFiles = await liveCurrentFiles(projectId);
    const synced = syncRabLinesFromBoqs(
      filterCountedBoqs(draft.boqs, currentFiles),
      draft.rabLines,
    );
    if (synced.length === 0) {
      throw new Error("A committed RAB needs at least one line");
    }
    assertAllLinesPriced(synced, "before commit");

    const now = new Date();
    const baseline = this.resolveBaseline(draft);
    const rabLines = stampAddedLinesOnCommit(
      baseline.lines,
      synced,
      userId,
      draft.reason,
      now,
    );

    const liveBoqs = (await ProjectShopDrawingBoqRepo.model
      .find({ projectId: projectOid })
      .lean()
      .exec()) as Array<
      LeanBoqDoc & { _id: Types.ObjectId; contentFrozenAt?: Date }
    >;
    const liveByFile = new Map(
      liveBoqs.map((b) => [String(b.shopDrawingFileId), b]),
    );
    const draftFileIds = new Set(
      draft.boqs.map((b) => String(b.shopDrawingFileId)),
    );

    const updated = await withTx(async () => {
      for (const snap of draft.boqs) {
        const existing = liveByFile.get(String(snap.shopDrawingFileId));
        // Keep the original freeze time for BOQs this change did not touch.
        const unchanged =
          existing && boqContentKey(existing) === boqContentKey(snap);
        if (unchanged) continue;
        const setDoc = {
          projectId: projectOid,
          shopDrawingItemId: snap.shopDrawingItemId,
          shopDrawingFileId: snap.shopDrawingFileId,
          makeQty: snap.makeQty,
          main: snap.main,
          lighting: snap.lighting,
          mounting: snap.mounting,
          other: snap.other,
          contentFrozenAt: now,
        };
        if (existing) {
          await ProjectShopDrawingBoqRepo.findByIdAndUpdate(
            String(existing._id),
            { $set: setDoc, $unset: { lines: 1 } },
          );
        } else {
          await ProjectShopDrawingBoqRepo.create(setDoc);
        }
      }

      for (const live of liveBoqs) {
        if (!draftFileIds.has(String(live.shopDrawingFileId))) {
          await ProjectShopDrawingBoqRepo.deleteOne({
            _id: live._id,
            projectId: projectOid,
          });
        }
      }

      await ProjectRabRepo.findOneAndUpdate(
        { _id: rab._id, status: "locked" },
        { $set: { lines: rabLines } },
      );

      const nextRevision =
        (await this.latestCommittedRevision(projectId)) + 1;

      const row = (await ProjectRabChangeRepo.findOneAndUpdate(
        { _id: draft._id, status: "draft" },
        {
          $set: {
            status: "committed",
            committedBy: new Types.ObjectId(userId),
            committedAt: now,
            revision: nextRevision,
            rabLines,
            boqs: draft.boqs,
            currentFiles,
          },
        },
      )) as LeanChange | null;
      // Throwing aborts the transaction: nothing above is kept.
      if (!row) throw new Error(DRAFT_GONE);
      return row;
    });

    const names = await userEmailsById([
      String(updated.openedBy),
      userId,
    ]);
    return this.toSummary(updated, names);
  }

  /** Rebuild the draft's RAB lines from its BOQs (current versions only) and save. */
  async syncDraft(projectId: string, draft: LeanChange): Promise<LeanChange> {
    const currentFiles = await liveCurrentFiles(projectId);
    const rabLines = syncRabLinesFromBoqs(
      filterCountedBoqs(draft.boqs, currentFiles),
      draft.rabLines,
    );
    return this.writeDraft(draft._id, { rabLines });
  }

  async upsertBoqInDraft(
    projectId: string,
    snap: ProjectRabChangeBoqSnapshot,
  ): Promise<LeanChange> {
    const draft = await this.findOpenDraft(projectId);
    if (!draft) {
      throw new Error("RAB is locked: open a change before editing BOQ");
    }
    const fileId = String(snap.shopDrawingFileId);
    const boqs = [...draft.boqs];
    const idx = boqs.findIndex(
      (b) => String(b.shopDrawingFileId) === fileId,
    );
    if (idx >= 0) boqs[idx] = snap;
    else boqs.push(snap);

    const currentFiles = await liveCurrentFiles(projectId);
    const rabLines = syncRabLinesFromBoqs(
      filterCountedBoqs(boqs, currentFiles),
      draft.rabLines,
    );
    return this.writeDraft(draft._id, { boqs, rabLines });
  }

  async removeBoqFromDraft(
    projectId: string,
    shopDrawingFileId: string,
  ): Promise<void> {
    const draft = await this.findOpenDraft(projectId);
    if (!draft) {
      throw new Error("RAB is locked: open a change before deleting BOQ");
    }
    const boqs = draft.boqs.filter(
      (b) => String(b.shopDrawingFileId) !== shopDrawingFileId,
    );
    const currentFiles = await liveCurrentFiles(projectId);
    const rabLines = syncRabLinesFromBoqs(
      filterCountedBoqs(boqs, currentFiles),
      draft.rabLines,
    );
    await this.writeDraft(draft._id, { boqs, rabLines });
  }

  async saveRabLinesInDraft(
    projectId: string,
    rabLines: ProjectRabLine[],
  ): Promise<LeanChange> {
    const draft = await this.findOpenDraft(projectId);
    if (!draft) {
      throw new Error("RAB is locked: open a change before editing RAB");
    }
    return this.writeDraft(draft._id, { rabLines });
  }

  /** Every draft write is conditional on the change still being a draft. */
  private async writeDraft(
    id: Types.ObjectId,
    set: Partial<Pick<ProjectRabChangeInterface, "boqs" | "rabLines">>,
  ): Promise<LeanChange> {
    const updated = (await ProjectRabChangeRepo.findOneAndUpdate(
      { _id: id, status: "draft" },
      { $set: set },
    )) as LeanChange | null;
    if (!updated) throw new Error(DRAFT_GONE);
    return updated;
  }

  /** Make each recorded file current again (only where it still exists). */
  private async restoreCurrentFiles(
    projectId: string,
    wanted: ProjectRabChangeCurrentFile[],
  ): Promise<void> {
    const projectOid = new Types.ObjectId(projectId);
    for (const ref of wanted) {
      const target = await ProjectShopDrawingDocumentRepo.model
        .findOne({
          _id: ref.shopDrawingFileId,
          projectId: projectOid,
          isDeleted: { $ne: true },
        })
        .select({ _id: 1, isCurrent: 1 })
        .lean()
        .exec();
      if (!target || target.isCurrent) continue;
      const others = await ProjectShopDrawingDocumentRepo.model
        .find({
          projectId: projectOid,
          itemId: ref.shopDrawingItemId,
          isCurrent: true,
        })
        .select({ _id: 1 })
        .lean()
        .exec();
      for (const other of others) {
        await ProjectShopDrawingDocumentRepo.findByIdAndUpdate(
          String(other._id),
          { $set: { isCurrent: false } },
        );
      }
      await ProjectShopDrawingDocumentRepo.findByIdAndUpdate(
        String(target._id),
        { $set: { isCurrent: true } },
      );
    }
  }

  /** Resolve baseline for diff (legacy drafts fall back to empty → use live if provided). */
  resolveBaseline(
    doc: LeanChange,
    liveFallback?: {
      lines: ProjectRabLine[];
      boqs: LeanBoqDoc[];
    },
  ): { lines: ProjectRabLine[]; boqs: ProjectRabChangeBoqSnapshot[] } {
    let lines = baselineLinesOf(doc);
    let boqs = baselineBoqsOf(doc);
    if (
      lines.length === 0 &&
      boqs.length === 0 &&
      liveFallback &&
      doc.status === "draft"
    ) {
      lines = liveFallback.lines;
      boqs = liveFallback.boqs.map(cloneBoqSnap);
    }
    return { lines, boqs };
  }

  private async toDetail(doc: LeanChange): Promise<ProjectRabChangeDetailOutDto> {
    const summary = this.toSummary(
      doc,
      await userEmailsById([
        String(doc.openedBy),
        ...(doc.committedBy ? [String(doc.committedBy)] : []),
      ]),
    );
    let baseline = this.resolveBaseline(doc);
    if (baseline.lines.length === 0 && baseline.boqs.length === 0) {
      if (doc.status === "draft") {
        const projectOid = doc.projectId;
        const [liveRab, liveBoqs] = await Promise.all([
          ProjectRabRepo.model.findOne({ projectId: projectOid }).lean().exec(),
          ProjectShopDrawingBoqRepo.model
            .find({ projectId: projectOid })
            .lean()
            .exec(),
        ]);
        if (liveRab) {
          baseline = this.resolveBaseline(doc, {
            lines: liveRab.lines as ProjectRabLine[],
            boqs: liveBoqs as LeanBoqDoc[],
          });
        }
      } else if (doc.status === "committed" && doc.committedAt) {
        const prev = (await ProjectRabChangeRepo.model
          .findOne({
            projectId: doc.projectId,
            status: "committed",
            committedAt: { $lt: doc.committedAt },
          })
          .sort({ committedAt: -1 })
          .lean()
          .exec()) as LeanChange | null;
        if (prev) {
          baseline = { lines: prev.rabLines, boqs: prev.boqs };
        }
      }
    }

    // Which file version each item counted with, before and after.
    const baselineCurrent = doc.baselineCurrentFiles ?? null;
    const nextCurrent =
      doc.status === "draft"
        ? await liveCurrentFiles(String(doc.projectId))
        : (doc.currentFiles ?? null);
    const baselineCounted = filterCountedBoqs(baseline.boqs, baselineCurrent);
    const nextCounted = filterCountedBoqs(doc.boqs, nextCurrent);

    // Committed / discarded records are history: show them as stored.
    const nextLines =
      doc.status === "draft"
        ? syncRabLinesFromBoqs(nextCounted, doc.rabLines)
        : doc.rabLines;
    const lineDiffRaw = diffRabLines(baseline.lines, nextLines);
    const boqDiffRaw = diffBoqFiles(baselineCounted, nextCounted);
    const boqMaterialDiff = diffBoqMaterialContributions(
      baselineCounted,
      nextCounted,
    );
    const versionDiffRaw =
      baselineCurrent && nextCurrent
        ? diffCurrentFiles(baselineCurrent, nextCurrent)
        : [];

    const itemIds = [
      ...new Set(
        [...nextLines, ...baseline.lines].map((l) => String(l.materialItemId)),
      ),
    ];
    const itemMeta = new Map<string, { code: string; name: string }>();
    await Promise.all(
      itemIds.map(async (id) => {
        const item = await itemMasterService.getById(id);
        itemMeta.set(id, {
          code: item?.itemId ?? "—",
          name: item?.name ?? "Unknown",
        });
      }),
    );
    const uomMeta = new Map<string, { symbol: string; name: string }>();
    await Promise.all(
      itemIds.map(async (id) => {
        const uoms = await itemUomService.listByItem(id);
        for (const u of uoms) uomMeta.set(u.id, { symbol: u.symbol, name: u.name });
      }),
    );

    const lineByKey = new Map(nextLines.map((l) => [l.key, l]));
    const baseByKey = new Map(baseline.lines.map((l) => [l.key, l]));

    const lineDiff: ProjectRabChangeLineDiffOutDto[] = lineDiffRaw.map((d) => {
      const src = lineByKey.get(d.key) ?? baseByKey.get(d.key);
      const materialItemId = src ? String(src.materialItemId) : null;
      const meta = materialItemId ? itemMeta.get(materialItemId) : undefined;
      const uomId = src ? String(src.itemUomId) : null;
      return {
        key: d.key,
        kind: d.kind,
        materialItemId,
        materialCode: meta?.code ?? null,
        materialName: meta?.name ?? null,
        uomSymbol: uomId ? (uomMeta.get(uomId)?.symbol ?? null) : null,
        oldTotalQty: d.oldTotalQty,
        newTotalQty: d.newTotalQty,
        oldUnitPrice: d.oldUnitPrice,
        newUnitPrice: d.newUnitPrice,
      };
    });

    const drawingItemIds = [
      ...new Set([
        ...boqDiffRaw.map((b) => b.shopDrawingItemId),
        ...versionDiffRaw.map((v) => v.shopDrawingItemId),
      ]),
    ];
    const itemNames = new Map<string, string>();
    if (drawingItemIds.length > 0) {
      const items = await ProjectShopDrawingItemRepo.model
        .find({
          _id: { $in: drawingItemIds.map((id) => new Types.ObjectId(id)) },
        })
        .select({ name: 1 })
        .lean()
        .exec();
      for (const it of items) {
        itemNames.set(String(it._id), (it as { name?: string }).name ?? "—");
      }
    }
    const versions = await fileVersionsById([
      ...boqDiffRaw.map((b) => b.shopDrawingFileId),
      ...versionDiffRaw.flatMap((v) =>
        [v.fromFileId, v.toFileId].filter((id): id is string => Boolean(id)),
      ),
    ]);

    const boqDiff: ProjectRabChangeBoqDiffOutDto[] = boqDiffRaw.map((b) => ({
      shopDrawingItemId: b.shopDrawingItemId,
      shopDrawingFileId: b.shopDrawingFileId,
      shopDrawingItemName: itemNames.get(b.shopDrawingItemId) ?? "—",
      fileVersion: versions.get(b.shopDrawingFileId) ?? null,
      kind: b.kind,
    }));

    const versionDiff: ProjectRabChangeVersionDiffOutDto[] = versionDiffRaw.map(
      (v) => ({
        shopDrawingItemId: v.shopDrawingItemId,
        shopDrawingItemName: itemNames.get(v.shopDrawingItemId) ?? "—",
        fromFileId: v.fromFileId,
        fromVersion: v.fromFileId ? (versions.get(v.fromFileId) ?? null) : null,
        toFileId: v.toFileId,
        toVersion: v.toFileId ? (versions.get(v.toFileId) ?? null) : null,
      }),
    );

    const addedByNames = await userEmailsById(
      nextLines
        .map((l) => (l.addedBy ? String(l.addedBy) : null))
        .filter((id): id is string => Boolean(id)),
    );

    const linesOut: ProjectRabLineOutDto[] = nextLines.map((line) => {
      const materialItemId = String(line.materialItemId);
      const itemUomId = String(line.itemUomId);
      const meta = itemMeta.get(materialItemId) ?? {
        code: "—",
        name: "Unknown",
      };
      const uom = uomMeta.get(itemUomId);
      const unitPrice = line.unitPrice ?? null;
      const addedById = line.addedBy ? String(line.addedBy) : null;
      return {
        key: line.key,
        materialItemId,
        materialCode: meta.code,
        materialName: meta.name,
        itemUomId,
        uomSymbol: uom?.symbol ?? "—",
        uomName: uom?.name ?? "—",
        totalQty: line.totalQty,
        unitPrice,
        tarifId: line.tarifId ? String(line.tarifId) : null,
        lineTotal: computeLineTotal(line.totalQty, unitPrice),
        hasTarif: false,
        origin: line.origin ?? null,
        addedAt: line.addedAt ? new Date(line.addedAt).toISOString() : null,
        addedBy: addedById
          ? { id: addedById, name: addedByNames.get(addedById) ?? addedById }
          : null,
        addReason: line.addReason?.trim() ? line.addReason.trim() : null,
        priceEditable: false,
      };
    });

    return {
      ...summary,
      lineDiff,
      boqDiff,
      versionDiff,
      boqMaterialDiff,
      baselineGrandTotal: sumLineTotals(baseline.lines),
      grandTotal: sumLineTotals(nextLines),
      lines: linesOut,
    };
  }

  private toSummary(
    doc: LeanChange,
    names: Map<string, string>,
  ): ProjectRabChangeSummaryOutDto {
    const userRef = (id: string | null): ProjectRabUserRefOutDto | null => {
      if (!id) return null;
      return { id, name: names.get(id) ?? id };
    };
    return {
      id: String(doc._id),
      projectId: String(doc.projectId),
      reason: doc.reason,
      status: doc.status,
      openedAt: doc.openedAt.toISOString(),
      openedBy: userRef(String(doc.openedBy))!,
      committedAt: doc.committedAt ? doc.committedAt.toISOString() : null,
      committedBy: userRef(doc.committedBy ? String(doc.committedBy) : null),
      revision:
        doc.status === "committed" && typeof doc.revision === "number"
          ? doc.revision
          : null,
    };
  }

  async latestCommittedRevision(projectId: string): Promise<number> {
    const rows = (await ProjectRabChangeRepo.model
      .find({
        projectId: new Types.ObjectId(projectId),
        status: "committed",
      })
      .select({ revision: 1 })
      .lean()
      .exec()) as Array<{ revision?: number }>;
    let maxRev = 0;
    for (const row of rows) {
      if (typeof row.revision === "number" && row.revision > maxRev) {
        maxRev = row.revision;
      }
    }
    return maxRev;
  }

  async findCommittedByRevision(
    projectId: string,
    revision: number,
  ): Promise<LeanChange | null> {
    return (await ProjectRabChangeRepo.model
      .findOne({
        projectId: new Types.ObjectId(projectId),
        status: "committed",
        revision,
      })
      .lean()
      .exec()) as LeanChange | null;
  }
}

export const projectRabChangeService = new ProjectRabChangeService();

export type LeanRabChange = LeanChange;
