import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import type {
  OpenProjectRabChangeInDto,
  ProjectRabChangeBoqDiffOutDto,
  ProjectRabChangeBoqMaterialDiffOutDto,
  ProjectRabChangeDetailOutDto,
  ProjectRabChangeLineDiffOutDto,
  ProjectRabChangeSummaryOutDto,
  ProjectRabChangeVersionDiffOutDto,
  ProjectRabLockOriginOutDto,
} from "../../dto/projectRabChange.dto";
import type {
  ProjectRabLineOutDto,
  ProjectRabMaterialChangeGroupOutDto,
  ProjectRabUserRefOutDto,
} from "../../dto/projectRab.dto";
import {
  ProjectRabChangeRepo,
  type ProjectRabChangeBoqSnapshot,
  type ProjectRabChangeCurrentFile,
  type ProjectRabChangeInterface,
} from "../../models/projectRabChange.model";
import {
  ProjectRabRepo,
  type ProjectRabLine,
} from "../../models/projectRab.model";
import type { PurchaseCharge } from "../../models/purchaseCharge.model";
import { ProjectShopDrawingBoqRepo } from "../../models/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem.model";
import { loadItemMeta } from "../itemMaster/itemMeta";
import { fileVersionsById, liveCurrentFiles } from "./projectCurrentFiles";
import {
  diffBoqFiles,
  diffBoqMaterialContributions,
  diffCurrentFiles,
  diffRabLines,
  filterCountedBoqs,
  productionConflicts,
  sumLineTotals,
  syncRabLinesFromBoqs,
  type LeanBoqDoc,
} from "./projectRabChange.planner";
import { assertProjectExists, shopDrawingItemLabel } from "./projectShared";
import { userEmailsById, userRefsById } from "../../utils/shared";
import { logger } from "../../core/logger";
import {
  assertAllLinesPriced,
  computeLineTotal,
  rabQtyWaste,
  rabTotalsWithCharges,
} from "./projectRab.planner";
import { loadRabUomPlan } from "./projectRabUomPlan";
import { purgeShopDrawingItem } from "./projectShopDrawingPurge";
import { ProductionOrderRepo } from "../../models/productionOrder.model";
import { ProductionReportRepo } from "../../models/productionReport.model";
import { allocatedQty } from "../production/production.planner";
import { formatDecimal, parseQtyDecimal } from "../itemMaster/itemUomConvert";

export { syncRabLinesFromBoqs } from "./projectRabChange.planner";

type LeanChange = ProjectRabChangeInterface & { _id: Types.ObjectId };

function cloneCharges(charges: PurchaseCharge[]): PurchaseCharge[] {
  return charges.map((c) => ({
    category: c.category ?? null,
    label: c.label,
    kind: c.kind,
    rate: c.rate ?? null,
    amount: c.amount,
  }));
}

/** Charges a committed change leaves on the RAB (legacy drafts keep the RAB's). */
function chargesOf(
  draft: LeanChange,
  rabCharges: PurchaseCharge[] | undefined,
): PurchaseCharge[] {
  return cloneCharges(draft.charges ?? rabCharges ?? []);
}

const DRAFT_GONE = "The change is no longer open (it was committed or discarded)";

/** Items with live SPKs → label and the qty those SPKs hold. */
async function heldQtyByItem(
  projectId: string,
): Promise<Map<string, { label: string; heldQty: string }>> {
  const orders = await ProductionOrderRepo.model
    .find({ projectId: new Types.ObjectId(projectId), status: { $ne: "cancelled" } })
    .select({ shopDrawingItemId: 1, status: 1, qty: 1 })
    .lean()
    .exec();
  if (orders.length === 0) return new Map();
  const [reports, items] = await Promise.all([
    ProductionReportRepo.model
      .find({ productionOrderId: { $in: orders.map((o) => o._id) }, isVoided: false })
      .select({ productionOrderId: 1, qtyDone: 1 })
      .lean()
      .exec(),
    ProjectShopDrawingItemRepo.model
      .find({ _id: { $in: orders.map((o) => o.shopDrawingItemId) } })
      .select({ code: 1, name: 1 })
      .lean()
      .exec(),
  ]);
  const done = new Map<string, string>();
  for (const r of reports) {
    const key = String(r.productionOrderId);
    done.set(key, formatDecimal(parseQtyDecimal(done.get(key) ?? "0").add(r.qtyDone)));
  }
  const labelById = new Map(items.map((i) => [String(i._id), shopDrawingItemLabel(i)]));
  const out = new Map<string, { label: string; heldQty: string }>();
  for (const itemId of new Set(orders.map((o) => String(o.shopDrawingItemId)))) {
    const rows = orders
      .filter((o) => String(o.shopDrawingItemId) === itemId)
      .map((o) => ({ id: String(o._id), status: o.status, qty: o.qty }));
    out.set(itemId, {
      label: labelById.get(itemId) ?? "Shop drawing item",
      heldQty: formatDecimal(allocatedQty(rows, done)),
    });
  }
  return out;
}

/** Commit check after release: live SPKs keep their item and their qty. */
async function assertProductionKept(
  projectId: string,
  countedBoqs: Array<{ shopDrawingItemId: Types.ObjectId | string; makeQty: string }>,
  removedItemIds: string[],
): Promise<void> {
  const held = await heldQtyByItem(projectId);
  if (held.size === 0) return;
  const makeByItem = new Map(
    countedBoqs.map((b) => [String(b.shopDrawingItemId), b.makeQty]),
  );
  const conflicts = productionConflicts(
    [...held].map(([itemId, h]) => ({
      ...h,
      nextMakeQty: removedItemIds.includes(itemId)
        ? null
        : (makeByItem.get(itemId) ?? null),
    })),
  );
  if (conflicts.length > 0) {
    throw new Error(`Cannot commit: ${conflicts.join("; ")}`);
  }
}

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
    mockupApproveDate: boq.mockupApproveDate ?? null,
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
    mockupApproveDate: boq.mockupApproveDate ?? null,
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
    // Allowed after release too (e.g. outsourcing an item): the change keeps its
    // reason, who/when and diff, and commit refuses to undercut live SPKs.
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
    const chargeSnaps = cloneCharges(rab.charges ?? []);
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
      baselineCharges: chargeSnaps,
      charges: cloneCharges(chargeSnaps),
    });

    return this.toSummary(
      created as unknown as LeanChange,
      await userRefsById([userId]),
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
    const refs = await userRefsById(userIds);
    return rows.map((r) => this.toSummary(r, refs));
  }

  /**
   * Who locked the RAB and which lines existed at that moment (oldest change
   * baseline, or current lines when no change has been opened yet).
   */
  async lockOrigin(projectId: string): Promise<ProjectRabLockOriginOutDto | null> {
    await assertProjectExists(projectId);
    const projectOid = new Types.ObjectId(projectId);
    const rab = await ProjectRabRepo.model.findOne({ projectId: projectOid }).lean().exec();
    if (!rab || rab.status !== "locked" || !rab.lockedAt || !rab.lockedBy) {
      return null;
    }

    const oldest = (await ProjectRabChangeRepo.model
      .find({ projectId: projectOid })
      .sort({ openedAt: 1 })
      .limit(1)
      .lean()
      .exec()) as LeanChange[];

    const baselineLines: ProjectRabLine[] =
      oldest[0]?.baselineRabLines?.length
        ? oldest[0].baselineRabLines
        : ((rab.lines ?? []) as ProjectRabLine[]);

    const itemIds = [
      ...new Set(baselineLines.map((l) => String(l.materialItemId))),
    ];
    const [{ items: itemMeta, uoms: uomMeta }, refs] = await Promise.all([
      loadItemMeta(itemIds),
      userRefsById([String(rab.lockedBy)]),
    ]);

    const lockedById = String(rab.lockedBy);
    const lockedBy =
      refs.get(lockedById) ?? {
        id: lockedById,
        name: lockedById,
        profilePicture: null,
      };

    const lines: ProjectRabChangeLineDiffOutDto[] = baselineLines.map((line) => {
      const materialItemId = String(line.materialItemId);
      const itemUomId = String(line.itemUomId);
      const meta = itemMeta.get(materialItemId);
      const unitPrice = line.unitPrice ?? null;
      return {
        key: line.key,
        kind: "added",
        materialItemId,
        materialCode: meta?.code ?? null,
        materialName: meta?.name ?? null,
        uomSymbol: uomMeta.get(itemUomId)?.symbol ?? null,
        oldTotalQty: null,
        newTotalQty: line.totalQty,
        oldUnitPrice: null,
        newUnitPrice: unitPrice,
      };
    });

    return {
      lockedAt: rab.lockedAt.toISOString(),
      lockedBy,
      grandTotal: sumLineTotals(baselineLines),
      lines,
    };
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
   * Shop drawing material changes per committed change (newest first), with
   * the open draft (already described by the caller) on top.
   */
  async materialChangeHistory(
    projectId: string,
    draftDetail: ProjectRabChangeDetailOutDto | null,
  ): Promise<ProjectRabMaterialChangeGroupOutDto[]> {
    const committed = (await ProjectRabChangeRepo.model
      .find({ projectId: new Types.ObjectId(projectId), status: "committed" })
      .sort({ committedAt: -1 })
      .lean()
      .exec()) as LeanChange[];
    const details = [
      ...(draftDetail ? [draftDetail] : []),
      ...(await Promise.all(committed.map((doc) => this.toDetail(doc)))),
    ];
    return details
      .filter((d) => d.boqMaterialDiff.length > 0)
      .map((d) => ({
        changeId: d.id,
        status: d.status === "draft" ? "draft" : "committed",
        revision: d.revision,
        reason: d.reason,
        at: d.committedAt ?? d.openedAt,
        by: d.committedBy ?? d.openedBy,
        materials: d.boqMaterialDiff,
      }));
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
    const refs = await userRefsById([String(updated.openedBy)]);
    return this.toSummary(updated, refs);
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

    const removedItemIds = (draft.removedItemIds ?? []).map(String);
    const currentFiles = (await liveCurrentFiles(projectId)).filter(
      (f) => !removedItemIds.includes(String(f.shopDrawingItemId)),
    );
    const counted = filterCountedBoqs(draft.boqs, currentFiles);
    const synced = syncRabLinesFromBoqs(
      counted,
      draft.rabLines,
      await loadRabUomPlan(counted),
    );
    if (synced.length === 0) {
      throw new Error("A committed RAB needs at least one line");
    }
    assertAllLinesPriced(synced, "before commit");
    await assertProductionKept(projectId, counted, removedItemIds);

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
          mockupApproveDate: snap.mockupApproveDate ?? null,
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
        { $set: { lines: rabLines, charges: chargesOf(draft, rab.charges) } },
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
            charges: chargesOf(draft, rab.charges),
            boqs: draft.boqs,
            currentFiles,
          },
        },
      )) as LeanChange | null;
      // Throwing aborts the transaction: nothing above is kept.
      if (!row) throw new Error(DRAFT_GONE);
      return row;
    });

    // Files live in GridFS (not transactional): delete removed items only once committed.
    for (const itemId of removedItemIds) {
      try {
        await purgeShopDrawingItem(projectId, itemId);
      } catch (error) {
        logger.error(
          `Failed to delete removed item ${itemId}: ${error instanceof Error ? error.message : String(error)}`,
          "modules/project/projectRabChange.service.ts",
          "commit",
        );
      }
    }

    const refs = await userRefsById([String(updated.openedBy), userId]);
    return this.toSummary(updated, refs);
  }

  /**
   * Remove a shop drawing item inside the open change: its BOQ leaves the
   * change (RAB lines resync) and the item is deleted on commit.
   */
  async markItemRemovedInDraft(projectId: string, itemId: string): Promise<void> {
    const draft = await this.findOpenDraft(projectId);
    if (!draft) {
      throw new Error("RAB is locked: open a change before removing an item");
    }
    const removed = (draft.removedItemIds ?? []).map(String);
    if (removed.includes(itemId)) return;
    const conflicts = productionConflicts(
      [...(await heldQtyByItem(projectId))]
        .filter(([id]) => id === itemId)
        .map(([, held]) => ({ ...held, nextMakeQty: null })),
    );
    if (conflicts.length > 0) throw new Error(conflicts[0]);
    const boqs = draft.boqs.filter(
      (b) => String(b.shopDrawingItemId) !== itemId,
    );
    const currentFiles = await liveCurrentFiles(projectId);
    const counted = filterCountedBoqs(boqs, currentFiles);
    const rabLines = syncRabLinesFromBoqs(
      counted,
      draft.rabLines,
      await loadRabUomPlan(counted),
    );
    await this.writeDraft(draft._id, {
      boqs,
      rabLines,
      removedItemIds: [...removed, itemId].map((id) => new Types.ObjectId(id)),
    });
  }

  /** Undo a removal in the open change: the item's BOQ from when the change opened comes back. */
  async restoreItemInDraft(projectId: string, itemId: string): Promise<void> {
    const draft = await this.findOpenDraft(projectId);
    if (!draft) throw new Error("No open draft change");
    const removed = (draft.removedItemIds ?? []).map(String);
    if (!removed.includes(itemId)) {
      throw new Error("This item is not removed in the open change");
    }
    const present = new Set(draft.boqs.map((b) => String(b.shopDrawingFileId)));
    const restored = baselineBoqsOf(draft)
      .filter(
        (b) =>
          String(b.shopDrawingItemId) === itemId &&
          !present.has(String(b.shopDrawingFileId)),
      )
      .map(cloneBoqSnap);
    const boqs = [...draft.boqs, ...restored];
    const currentFiles = await liveCurrentFiles(projectId);
    const counted = filterCountedBoqs(boqs, currentFiles);
    const rabLines = syncRabLinesFromBoqs(
      counted,
      draft.rabLines,
      await loadRabUomPlan(counted),
    );
    await this.writeDraft(draft._id, {
      boqs,
      rabLines,
      removedItemIds: removed
        .filter((id) => id !== itemId)
        .map((id) => new Types.ObjectId(id)),
    });
  }

  /** Rebuild the draft's RAB lines from its BOQs (current versions only) and save. */
  async syncDraft(projectId: string, draft: LeanChange): Promise<LeanChange> {
    const currentFiles = await liveCurrentFiles(projectId);
    const counted = filterCountedBoqs(draft.boqs, currentFiles);
    const rabLines = syncRabLinesFromBoqs(
      counted,
      draft.rabLines,
      await loadRabUomPlan(counted),
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
    if (
      (draft.removedItemIds ?? []).some(
        (id) => String(id) === String(snap.shopDrawingItemId),
      )
    ) {
      throw new Error(
        "This item is removed in the open change: restore it before editing its BOQ",
      );
    }
    const fileId = String(snap.shopDrawingFileId);
    const boqs = [...draft.boqs];
    const idx = boqs.findIndex(
      (b) => String(b.shopDrawingFileId) === fileId,
    );
    if (idx >= 0) boqs[idx] = snap;
    else boqs.push(snap);

    const currentFiles = await liveCurrentFiles(projectId);
    const counted = filterCountedBoqs(boqs, currentFiles);
    const rabLines = syncRabLinesFromBoqs(
      counted,
      draft.rabLines,
      await loadRabUomPlan(counted),
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
    const counted = filterCountedBoqs(boqs, currentFiles);
    const rabLines = syncRabLinesFromBoqs(
      counted,
      draft.rabLines,
      await loadRabUomPlan(counted),
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

  async saveChargesInDraft(
    projectId: string,
    charges: PurchaseCharge[],
  ): Promise<LeanChange> {
    const draft = await this.findOpenDraft(projectId);
    if (!draft) {
      throw new Error("RAB is locked: open a change before editing RAB");
    }
    return this.writeDraft(draft._id, { charges });
  }

  /** Every draft write is conditional on the change still being a draft. */
  private async writeDraft(
    id: Types.ObjectId,
    set: Partial<
      Pick<
        ProjectRabChangeInterface,
        "boqs" | "rabLines" | "removedItemIds" | "charges"
      >
    >,
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
      await userRefsById([
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
    const plan = await loadRabUomPlan([...baselineCounted, ...nextCounted]);

    // Committed / discarded records are history: show them as stored.
    const nextLines =
      doc.status === "draft"
        ? syncRabLinesFromBoqs(nextCounted, doc.rabLines, plan)
        : doc.rabLines;
    const lineDiffRaw = diffRabLines(baseline.lines, nextLines);
    const boqDiffRaw = diffBoqFiles(baselineCounted, nextCounted);
    const boqMaterialDiffRaw = diffBoqMaterialContributions(
      baselineCounted,
      nextCounted,
      plan,
    );
    const versionDiffRaw =
      baselineCurrent && nextCurrent
        ? diffCurrentFiles(baselineCurrent, nextCurrent)
        : [];

    const itemIds = [
      ...new Set([
        ...[...nextLines, ...baseline.lines].map((l) => String(l.materialItemId)),
        // Key is `${materialItemId}:${itemUomId}`.
        ...boqMaterialDiffRaw.map((d) => d.key.split(":")[0]!),
      ]),
    ];
    const { items: itemMeta, uoms: uomMeta } = await loadItemMeta(itemIds);

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
        ...boqMaterialDiffRaw.map((d) => d.shopDrawingItemId),
        ...[...nextLines, ...baseline.lines].flatMap((l) =>
          l.shopDrawingItemId ? [String(l.shopDrawingItemId)] : [],
        ),
      ]),
    ];
    const itemNames = new Map<string, string>();
    if (drawingItemIds.length > 0) {
      const items = await ProjectShopDrawingItemRepo.model
        .find({
          _id: { $in: drawingItemIds.map((id) => new Types.ObjectId(id)) },
        })
        .select({ code: 1, name: 1 })
        .lean()
        .exec();
      for (const it of items) {
        itemNames.set(String(it._id), shopDrawingItemLabel(it));
      }
    }
    for (const d of lineDiff) {
      const src = lineByKey.get(d.key) ?? baseByKey.get(d.key);
      const drawing = src?.shopDrawingItemId
        ? itemNames.get(String(src.shopDrawingItemId))
        : undefined;
      if (drawing && d.materialName) {
        d.materialName = `${d.materialName} · ${drawing}`;
      }
    }
    const versions = await fileVersionsById([
      ...boqDiffRaw.map((b) => b.shopDrawingFileId),
      ...boqMaterialDiffRaw.map((d) => d.shopDrawingFileId),
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

    const boqMaterialDiff: ProjectRabChangeBoqMaterialDiffOutDto[] =
      boqMaterialDiffRaw.map((d) => {
        const [materialItemId = "", itemUomId = ""] = d.key.split(":");
        const meta = itemMeta.get(materialItemId);
        return {
          shopDrawingFileId: d.shopDrawingFileId,
          shopDrawingItemId: d.shopDrawingItemId,
          shopDrawingItemName: itemNames.get(d.shopDrawingItemId) ?? "—",
          fileVersion: versions.get(d.shopDrawingFileId) ?? null,
          key: d.key,
          kind: d.kind,
          materialCode: meta?.code ?? null,
          materialName: meta?.name ?? null,
          uomSymbol: uomMeta.get(itemUomId)?.symbol ?? null,
          oldTotalQty: d.oldTotalQty,
          newTotalQty: d.newTotalQty,
        };
      });

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
        exactQty: line.exactQty ?? null,
        wasteQty: rabQtyWaste(line.exactQty, line.totalQty),
        rounding: line.rounding
          ? {
              step: line.rounding.step,
              source: line.rounding.source,
              mode: line.rounding.mode,
            }
          : null,
        unitPrice,
        tarifId: line.tarifId ? String(line.tarifId) : null,
        lineTotal: computeLineTotal(line.totalQty, unitPrice),
        priceByTotal: line.priceByTotal === true,
        hasTarif: false,
        origin: line.origin ?? null,
        addedAt: line.addedAt ? new Date(line.addedAt).toISOString() : null,
        addedBy: addedById
          ? { id: addedById, name: addedByNames.get(addedById) ?? addedById }
          : null,
        addReason: line.addReason?.trim() ? line.addReason.trim() : null,
        priceEditable: false,
        shopDrawingItemId: line.shopDrawingItemId
          ? String(line.shopDrawingItemId)
          : null,
        shopDrawingItemName: line.shopDrawingItemId
          ? (itemNames.get(String(line.shopDrawingItemId)) ?? "—")
          : null,
        sequence:
          typeof line.sequence === "number" && line.sequence >= 1
            ? line.sequence
            : null,
        weightPercent:
          typeof line.weightPercent === "number" && line.weightPercent >= 1
            ? line.weightPercent
            : null,
      };
    });

    return {
      ...summary,
      lineDiff,
      boqDiff,
      versionDiff,
      boqMaterialDiff,
      baselineGrandTotal: rabTotalsWithCharges(
        sumLineTotals(baseline.lines),
        doc.baselineCharges ?? [],
      ).grandTotal,
      grandTotal: rabTotalsWithCharges(
        sumLineTotals(nextLines),
        doc.charges ?? [],
      ).grandTotal,
      lines: linesOut,
    };
  }

  private toSummary(
    doc: LeanChange,
    refs: Map<string, ProjectRabUserRefOutDto>,
  ): ProjectRabChangeSummaryOutDto {
    const userRef = (id: string | null): ProjectRabUserRefOutDto | null => {
      if (!id) return null;
      return (
        refs.get(id) ?? {
          id,
          name: id,
          profilePicture: null,
        }
      );
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
      .sort({ revision: -1 })
      .limit(1)
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
