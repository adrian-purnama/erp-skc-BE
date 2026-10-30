import { Types } from "mongoose";
import type {
  AddProjectRabLabourLineInDto,
  ProjectRabChangeDraftRefOutDto,
  ProjectRabChangeDiffOutDto,
  ProjectRabElaborationBlockOutDto,
  ProjectRabElaborationDocOutDto,
  ProjectRabElaborationLineOutDto,
  ProjectRabElaborationOutDto,
  ProjectRabItemGroupOutDto,
  ProjectRabLabourItemOutDto,
  ProjectRabLineOutDto,
  ProjectRabOutDto,
  ProjectRabUserRefOutDto,
  SaveProjectRabLabourProcessInDto,
} from "../../dto/projectRab.dto";
import type { ProjectRabChangeDetailOutDto } from "../../dto/projectRabChange.dto";
import type {
  ProjectShopDrawingBoqLineOutDto,
  ProjectShopDrawingBoqOutDto,
} from "../../dto/projectShopDrawingBoq.dto";
import {
  ProjectRabRepo,
  type ProjectRabInterface,
  type ProjectRabLine,
} from "../../models/projectRab.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem.model";
import type { PurchaseCharge } from "../../models/purchaseCharge.model";
import type { RealizationChargeInDto } from "../../dto/purchasing.dto";
import { checkRealizationCharges } from "../purchasing/purchaseRealization.planner";
import {
  ProjectShopDrawingBoqRepo,
  type ProjectShopDrawingBoqLine,
} from "../../models/projectShopDrawingBoq.model";
import { todayYmdUtc } from "../../validation/itemMaster";
import { itemMasterService } from "../itemMaster/itemMaster.service";
import { loadItemMeta } from "../itemMaster/itemMeta";
import { itemTarifService } from "../itemMaster/itemTarif.service";
import { itemUomService } from "../itemMaster/itemUom.service";
import { liveCurrentFiles } from "./projectCurrentFiles";
import { filterCountedBoqs, sumLineTotals } from "./projectRabChange.planner";
import {
  projectRabChangeService,
  type LeanRabChange,
} from "./projectRabChange.service";
import { assertProjectExists, shopDrawingItemLabel } from "./projectShared";
import { projectShopDrawingBoqService } from "./projectShopDrawingBoq.service";
import { loadRabUomPlan } from "./projectRabUomPlan";
import { userEmailsById, userRefsById } from "../../utils/shared";
import {
  aggregateBoqLinesToRab,
  assertAllLinesPriced,
  collectSourceLines,
  computeLineTotal,
  isLabourLine,
  mergeRabPricing,
  rabQtyWaste,
  rabTotalsWithCharges,
  sumGrandTotal,
  unitPriceFromLineTotal,
} from "./projectRab.planner";

type LeanBoq = {
  makeQty: string;
  main?: {
    parts?: Array<{
      bases?: Array<
        ProjectShopDrawingBoqLine & {
          finishings?: Array<{ lines?: ProjectShopDrawingBoqLine[] }>;
        }
      >;
    }>;
    assembly?: { lines?: ProjectShopDrawingBoqLine[] };
  };
  lighting?: { lines?: ProjectShopDrawingBoqLine[] };
  mounting?: { lines?: ProjectShopDrawingBoqLine[] };
  other?: { lines?: ProjectShopDrawingBoqLine[] };
};

type LeanRab = ProjectRabInterface & { _id: Types.ObjectId };

/** The open change's charges while one is open, else the RAB's own. */
function chargesFor(doc: LeanRab, change: LeanRabChange | null): PurchaseCharge[] {
  return (change ? change.charges : undefined) ?? doc.charges ?? [];
}

function linePriceEditable(
  status: ProjectRabInterface["status"],
  changeDraftOpen: boolean,
): boolean {
  if (status !== "locked") return true;
  return changeDraftOpen;
}

function toElabLine(
  line: ProjectShopDrawingBoqLineOutDto,
  makeQty: string,
): ProjectRabElaborationLineOutDto {
  return {
    materialItemId: line.materialItemId,
    itemUomId: line.itemUomId,
    materialName: line.materialName,
    materialCode: line.materialCode,
    uomSymbol: line.uomSymbol,
    qtyPerUnit: line.qtyPerUnit,
    makeQty,
    totalQty: line.totalQty,
  };
}

function pushBlock(
  blocks: ProjectRabElaborationBlockOutDto[],
  title: string,
  lines: ProjectRabElaborationLineOutDto[],
): void {
  if (lines.length === 0) return;
  blocks.push({ title, lines });
}

function boqToElaborationDoc(
  boq: ProjectShopDrawingBoqOutDto,
): ProjectRabElaborationDocOutDto {
  const blocks: ProjectRabElaborationBlockOutDto[] = [];
  const makeQty = boq.makeQty;

  for (const part of boq.main.parts) {
    const partLabel = part.label?.trim() || "Part";
    part.bases.forEach((base, baseIndex) => {
      const baseTitle =
        part.bases.length > 1
          ? `Base · ${partLabel} · ${baseIndex + 1}`
          : `Base · ${base.materialName}`;
      pushBlock(blocks, baseTitle, [toElabLine(base, makeQty)]);

      const top = [...base.finishings]
        .filter((f) => f.placement === "top")
        .sort((a, b) => b.finishingOrder - a.finishingOrder);
      for (const f of top) {
        pushBlock(
          blocks,
          `Finishing · top · ${base.materialName}`,
          f.lines.map((l) => toElabLine(l, makeQty)),
        );
      }

      const bottom = [...base.finishings]
        .filter((f) => f.placement === "bottom")
        .sort((a, b) => a.finishingOrder - b.finishingOrder);
      for (const f of bottom) {
        pushBlock(
          blocks,
          `Finishing · bottom · ${base.materialName}`,
          f.lines.map((l) => toElabLine(l, makeQty)),
        );
      }
    });
  }

  pushBlock(
    blocks,
    "Assembly",
    boq.main.assembly.lines.map((l) => toElabLine(l, makeQty)),
  );
  pushBlock(
    blocks,
    "Lighting",
    boq.lighting.lines.map((l) => toElabLine(l, makeQty)),
  );
  pushBlock(
    blocks,
    `Mounting · ${boq.mounting.type}`,
    boq.mounting.lines.map((l) => toElabLine(l, makeQty)),
  );
  pushBlock(
    blocks,
    "Other",
    boq.other.lines.map((l) => toElabLine(l, makeQty)),
  );

  return {
    shopDrawingItemId: boq.shopDrawingItemId,
    shopDrawingFileId: boq.shopDrawingFileId,
    shopDrawingItemName: boq.shopDrawingItemName,
    fileVersion: boq.fileVersion,
    originalFilename: boq.originalFilename,
    makeQty: boq.makeQty,
    blocks,
  };
}

/** `{code}-{name}` per shop drawing item id (deleted items included). */
export async function shopDrawingItemNames(
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
  if (unique.length === 0) return names;
  const items = await ProjectShopDrawingItemRepo.model
    .find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
    .select({ code: 1, name: 1 })
    .lean()
    .exec();
  for (const it of items) names.set(String(it._id), shopDrawingItemLabel(it));
  return names;
}

export class ProjectRabService {
  async get(
    projectId: string,
    userId: string,
  ): Promise<ProjectRabOutDto | null> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user id");
    }

    const projectOid = new Types.ObjectId(projectId);
    let doc = (await ProjectRabRepo.model
      .findOne({ projectId: projectOid })
      .lean()
      .exec()) as LeanRab | null;

    const status = doc?.status ?? "draft";
    const labourLines = (doc?.lines ?? []).filter(isLabourLine);

    if (status === "locked" && doc) {
      const change = await projectRabChangeService.findOpenDraft(projectId);
      if (change) {
        const synced = await projectRabChangeService.syncDraft(
          projectId,
          change,
        );
        return this.toOut(
          { ...doc, lines: synced.rabLines },
          synced,
        );
      }
      return this.toOut(doc, null);
    }

    const [allBoqs, currentFiles] = await Promise.all([
      ProjectShopDrawingBoqRepo.model
        .find({ projectId: projectOid })
        .lean()
        .exec() as Promise<Array<LeanBoq & { shopDrawingFileId: Types.ObjectId }>>,
      liveCurrentFiles(projectId),
    ]);
    // Only each item's current file version feeds the RAB.
    const boqs = filterCountedBoqs(allBoqs, currentFiles);
    const scaffold = aggregateBoqLinesToRab(
      collectSourceLines(boqs),
      await loadRabUomPlan(boqs),
    );

    // Draft: live qty from BOQ; keep labour lines; persist scaffold + prices
    if (scaffold.length === 0) {
      if (!doc) return null;
      const onlyLabour = labourLines;
      const needsTrim =
        doc.lines.length !== onlyLabour.length ||
        doc.lines.some((l) => !isLabourLine(l));
      if (needsTrim) {
        doc = (await ProjectRabRepo.findOneAndUpdate(
          { _id: doc._id },
          { $set: { lines: onlyLabour, status: "draft" } },
        )) as LeanRab | null;
        if (!doc) return null;
      }
      if (doc.lines.length === 0) return this.toOut(doc, null);
      return this.toOut(doc, null);
    }

    const previous = (doc?.lines ?? [])
      .filter((line) => !isLabourLine(line))
      .map((line) => ({
        key: line.key,
        unitPrice: line.unitPrice,
        tarifId: line.tarifId ? String(line.tarifId) : undefined,
        priceByTotal: line.priceByTotal,
      }));
    const merged = mergeRabPricing(scaffold, previous);
    const boqLines: ProjectRabLine[] = merged.map((row) => {
      const line: ProjectRabLine = {
        key: row.key,
        materialItemId: new Types.ObjectId(row.materialItemId),
        itemUomId: new Types.ObjectId(row.itemUomId),
        totalQty: row.totalQty,
        exactQty: row.exactQty,
      };
      if (row.rounding) line.rounding = row.rounding;
      if (row.unitPrice) line.unitPrice = row.unitPrice;
      if (row.tarifId && Types.ObjectId.isValid(row.tarifId)) {
        line.tarifId = new Types.ObjectId(row.tarifId);
      }
      if (row.priceByTotal) line.priceByTotal = true;
      return line;
    });
    const lines: ProjectRabLine[] = [...boqLines, ...labourLines];

    if (doc) {
      doc = (await ProjectRabRepo.findOneAndUpdate(
        { _id: doc._id },
        { $set: { lines, status: "draft" } },
      )) as LeanRab | null;
    } else {
      doc = (await ProjectRabRepo.create({
        projectId: projectOid,
        status: "draft",
        lines,
      })) as unknown as LeanRab;
    }
    if (!doc) throw new Error("Failed to save draft RAB");
    return this.toOut(doc, null);
  }

  async elaboration(projectId: string): Promise<ProjectRabElaborationOutDto> {
    await assertProjectExists(projectId);
    const projectOid = new Types.ObjectId(projectId);
    const change = await projectRabChangeService.findOpenDraft(projectId);
    const source: Array<{
      shopDrawingItemId: Types.ObjectId;
      shopDrawingFileId: Types.ObjectId;
    }> = change
      ? change.boqs
      : ((await ProjectShopDrawingBoqRepo.model
          .find({ projectId: projectOid })
          .select({ shopDrawingItemId: 1, shopDrawingFileId: 1 })
          .lean()
          .exec()) as Array<{
          shopDrawingItemId: Types.ObjectId;
          shopDrawingFileId: Types.ObjectId;
        }>);
    const boqs = filterCountedBoqs(source, await liveCurrentFiles(projectId));

    const documents: ProjectRabElaborationDocOutDto[] = (
      await projectShopDrawingBoqService.getMany(
        projectId,
        boqs.map((row) => String(row.shopDrawingFileId)),
      )
    ).map(boqToElaborationDoc);

    documents.sort((a, b) => {
      const byName = a.shopDrawingItemName.localeCompare(b.shopDrawingItemName);
      if (byName !== 0) return byName;
      return a.fileVersion - b.fileVersion;
    });

    return { documents };
  }

  async lock(projectId: string, userId: string): Promise<ProjectRabOutDto> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user id");
    }

    // Refresh draft from BOQ first
    const draft = await this.get(projectId, userId);
    if (!draft || draft.groups.length === 0) {
      throw new Error("Add Shop Drawing BOQ materials or labour before locking RAB");
    }

    const doc = await this.requireRab(projectId);
    if (doc.status === "locked") {
      throw new Error("RAB is already locked");
    }
    if (doc.lines.length === 0) {
      throw new Error("RAB has no lines to lock");
    }
    assertAllLinesPriced(doc.lines, "before lock");

    const now = new Date();
    const userOid = new Types.ObjectId(userId);
    const lines: ProjectRabLine[] = doc.lines.map((l) => {
      const next: ProjectRabLine = {
        ...l,
        origin: isLabourLine(l) ? "labour" : "lock",
        addedAt: now,
        addedBy: userOid,
      };
      delete next.addReason;
      return next;
    });

    const updated = (await ProjectRabRepo.findOneAndUpdate(
      { _id: doc._id },
      {
        $set: {
          status: "locked",
          lockedAt: now,
          lockedBy: userOid,
          lines,
        },
      },
    )) as LeanRab | null;
    if (!updated) throw new Error("Failed to lock RAB");

    await projectShopDrawingBoqService.freezeAllForProject(projectId);
    return this.toOut(updated, null);
  }

  async fillTarif(
    projectId: string,
    lineKey: string,
  ): Promise<ProjectRabOutDto> {
    await assertProjectExists(projectId);
    const { doc, change, lines: working } = await this.requireEditableLines(
      projectId,
    );
    const idx = working.findIndex((l) => l.key === lineKey);
    if (idx < 0) throw new Error("RAB line not found");

    const line = working[idx]!;
    const tarif = await itemTarifService.resolveAsOf(
      String(line.materialItemId),
      todayYmdUtc(),
    );
    if (!tarif) {
      throw new Error("No current tarif for this item");
    }

    const lines = working.map((l, i) => {
      if (i !== idx) return l;
      const next: ProjectRabLine = {
        ...l,
        unitPrice: tarif.amount,
        tarifId: new Types.ObjectId(tarif.id),
      };
      delete next.priceByTotal;
      return next;
    });

    return this.persistLines(projectId, doc, change, lines);
  }

  async listLabourItems(
    projectId: string,
  ): Promise<ProjectRabLabourItemOutDto[]> {
    await assertProjectExists(projectId);
    const items = await itemMasterService.listActiveItems("labour");
    const uomsByItem = await itemUomService.listByItems(items.map((i) => i.id));
    return items.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      name: item.name,
      description: item.description,
      baseUomId: item.baseUomId,
      uoms: uomsByItem.get(item.id) ?? [],
    }));
  }

  async addLabourLine(
    projectId: string,
    userId: string,
    input: AddProjectRabLabourLineInDto,
  ): Promise<ProjectRabOutDto> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid user id");
    }

    const item = await itemMasterService.getActiveById(input.itemId);
    if (!item) {
      throw new Error("Labour item must be an active item master item");
    }
    if (item.itemType !== "labour") {
      throw new Error("RAB labour lines must use labour item type");
    }
    const uoms = await itemUomService.listByItem(input.itemId);
    if (!uoms.some((u) => u.id === input.itemUomId)) {
      throw new Error("UOM must belong to the selected labour item");
    }

    const projectOid = new Types.ObjectId(projectId);
    const drawingItem = await ProjectShopDrawingItemRepo.model
      .findOne({
        _id: new Types.ObjectId(input.shopDrawingItemId),
        projectId: projectOid,
        isDeleted: { $ne: true },
      })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (!drawingItem) {
      throw new Error("Shop drawing item not found in this project");
    }
    const key = `${input.shopDrawingItemId}:${input.itemId}:${input.itemUomId}`;
    let doc = (await ProjectRabRepo.model
      .findOne({ projectId: projectOid })
      .lean()
      .exec()) as LeanRab | null;

    if (!doc) {
      await this.get(projectId, userId);
      doc = (await ProjectRabRepo.model
        .findOne({ projectId: projectOid })
        .lean()
        .exec()) as LeanRab | null;
    }
    if (!doc) {
      doc = (await ProjectRabRepo.create({
        projectId: projectOid,
        status: "draft",
        lines: [],
      })) as unknown as LeanRab;
    }
    if (!doc) throw new Error("Failed to create RAB");

    const change =
      doc.status === "locked"
        ? await projectRabChangeService.findOpenDraft(projectId)
        : null;
    if (doc.status === "locked" && !change) {
      throw new Error("RAB is locked: open a change before adding labour");
    }
    const working = change ? change.rabLines : doc.lines;
    if (working.some((l) => l.key === key)) {
      throw new Error(
        "This labour item and UOM are already on this shop drawing",
      );
    }

    const now = new Date();
    const userOid = new Types.ObjectId(userId);
    const drawingId = input.shopDrawingItemId;
    const siblings = working.filter(
      (l) =>
        isLabourLine(l) &&
        l.shopDrawingItemId !== undefined &&
        String(l.shopDrawingItemId) === drawingId,
    );
    const nextSeq =
      siblings.reduce((max, l) => Math.max(max, l.sequence ?? 0), 0) + 1;
    const labourLine: ProjectRabLine = {
      key,
      materialItemId: new Types.ObjectId(input.itemId),
      itemUomId: new Types.ObjectId(input.itemUomId),
      totalQty: input.totalQty,
      origin: "labour",
      addedAt: now,
      addedBy: userOid,
      shopDrawingItemId: new Types.ObjectId(input.shopDrawingItemId),
      sequence: nextSeq,
    };
    if (input.unitPrice !== undefined && input.unitPrice !== null) {
      labourLine.unitPrice = input.unitPrice;
    }

    return this.persistLines(projectId, doc, change, [
      ...working,
      labourLine,
    ]);
  }

  /**
   * Set process order + weight % for one drawing's labour lines.
   * Array order becomes sequence 1..n. Does not require weights to sum to 100
   * (that is checked when releasing an inhouse SPK).
   */
  async saveLabourProcess(
    projectId: string,
    input: SaveProjectRabLabourProcessInDto,
  ): Promise<ProjectRabOutDto> {
    await assertProjectExists(projectId);
    const { doc, change, lines: working } = await this.requireEditableLines(
      projectId,
    );
    const drawingId = input.shopDrawingItemId;
    const drawingLabour = working.filter(
      (l) =>
        isLabourLine(l) &&
        l.shopDrawingItemId !== undefined &&
        String(l.shopDrawingItemId) === drawingId,
    );
    if (drawingLabour.length === 0) {
      throw new Error("No labour lines on this shop drawing");
    }
    if (input.lines.length !== drawingLabour.length) {
      throw new Error(
        "Process list must include every labour line on this shop drawing",
      );
    }
    const byKey = new Map(drawingLabour.map((l) => [l.key, l]));
    for (const row of input.lines) {
      if (!byKey.has(row.key)) {
        throw new Error(`Labour line not on this shop drawing: ${row.key}`);
      }
    }
    const seqByKey = new Map(
      input.lines.map((row, i) => [row.key, { sequence: i + 1, weightPercent: row.weightPercent }]),
    );
    const lines = working.map((l) => {
      const meta = seqByKey.get(l.key);
      if (!meta) return l;
      return { ...l, sequence: meta.sequence, weightPercent: meta.weightPercent };
    });
    return this.persistLines(projectId, doc, change, lines);
  }

  async removeLabourLine(
    projectId: string,
    lineKey: string,
  ): Promise<ProjectRabOutDto> {
    await assertProjectExists(projectId);
    const { doc, change, lines: working } = await this.requireEditableLines(
      projectId,
    );
    const line = working.find((l) => l.key === lineKey);
    if (!line) throw new Error("RAB line not found");
    if (!isLabourLine(line)) {
      throw new Error("Only labour lines can be removed this way");
    }
    const drawingId = line.shopDrawingItemId
      ? String(line.shopDrawingItemId)
      : null;
    let lines = working.filter((l) => l.key !== lineKey);
    if (drawingId) {
      const remaining = lines
        .filter(
          (l) =>
            isLabourLine(l) &&
            l.shopDrawingItemId !== undefined &&
            String(l.shopDrawingItemId) === drawingId,
        )
        .sort((a, b) => (a.sequence ?? 9999) - (b.sequence ?? 9999));
      const seqByKey = new Map(
        remaining.map((l, i) => [l.key, i + 1]),
      );
      lines = lines.map((l) => {
        const seq = seqByKey.get(l.key);
        if (seq == null) return l;
        return { ...l, sequence: seq };
      });
    }
    return this.persistLines(projectId, doc, change, lines);
  }

  /** Remember whether a line's price is entered as a unit price or total. */
  async setLinePriceMode(
    projectId: string,
    lineKey: string,
    priceByTotal: boolean,
  ): Promise<ProjectRabOutDto> {
    await assertProjectExists(projectId);
    const { doc, change, lines: working } = await this.requireEditableLines(
      projectId,
    );
    if (!working.some((l) => l.key === lineKey)) {
      throw new Error("RAB line not found");
    }
    const lines = working.map((l) => {
      if (l.key !== lineKey) return l;
      const next: ProjectRabLine = { ...l };
      if (priceByTotal) next.priceByTotal = true;
      else delete next.priceByTotal;
      return next;
    });
    return this.persistLines(projectId, doc, change, lines);
  }

  async patchLinePrice(
    projectId: string,
    lineKey: string,
    unitPrice: string | null,
    lineTotal?: string,
  ): Promise<ProjectRabOutDto> {
    await assertProjectExists(projectId);
    const { doc, change, lines: working } = await this.requireEditableLines(
      projectId,
    );
    const idx = working.findIndex((l) => l.key === lineKey);
    if (idx < 0) throw new Error("RAB line not found");
    const price =
      lineTotal !== undefined
        ? unitPriceFromLineTotal(working[idx]!.totalQty, lineTotal)
        : unitPrice;

    const lines = working.map((l, i) => {
      if (i !== idx) return l;
      const next: ProjectRabLine = {
        key: l.key,
        materialItemId: l.materialItemId,
        itemUomId: l.itemUomId,
        totalQty: l.totalQty,
        ...(l.exactQty ? { exactQty: l.exactQty } : {}),
        ...(l.rounding ? { rounding: l.rounding } : {}),
        ...(l.origin ? { origin: l.origin } : {}),
        ...(l.addedAt ? { addedAt: l.addedAt } : {}),
        ...(l.addedBy ? { addedBy: l.addedBy } : {}),
        ...(l.addReason ? { addReason: l.addReason } : {}),
        ...(l.shopDrawingItemId
          ? { shopDrawingItemId: l.shopDrawingItemId }
          : {}),
        ...(l.sequence !== undefined ? { sequence: l.sequence } : {}),
        ...(l.weightPercent !== undefined
          ? { weightPercent: l.weightPercent }
          : {}),
      };
      if (price !== null && price !== "") {
        next.unitPrice = price;
        if (lineTotal !== undefined) next.priceByTotal = true;
      }
      return next;
    });

    return this.persistLines(projectId, doc, change, lines);
  }

  /** Replace the RAB's extra charges (in the open change once locked). */
  async saveCharges(
    projectId: string,
    input: RealizationChargeInDto[],
  ): Promise<ProjectRabOutDto> {
    await assertProjectExists(projectId);
    const { doc, change, lines } = await this.requireEditableLines(projectId);
    const { charges } = checkRealizationCharges(
      sumLineTotals(lines) ?? "0",
      input,
    );
    if (change) {
      const updated = await projectRabChangeService.saveChargesInDraft(
        projectId,
        charges,
      );
      return this.toOut({ ...doc, lines: updated.rabLines }, updated);
    }
    const updated = (await ProjectRabRepo.findOneAndUpdate(
      { _id: doc._id, status: "draft" },
      { $set: { charges } },
    )) as LeanRab | null;
    if (!updated) throw new Error("RAB was locked meanwhile; open a change");
    return this.toOut(updated, null);
  }

  private async requireEditableLines(projectId: string): Promise<{
    doc: LeanRab;
    change: LeanRabChange | null;
    lines: ProjectRabLine[];
  }> {
    const doc = await this.requireRab(projectId);
    if (doc.status !== "locked") {
      return { doc, change: null, lines: doc.lines };
    }
    const change = await projectRabChangeService.findOpenDraft(projectId);
    if (!change) {
      throw new Error("RAB is locked: open a change before editing");
    }
    return { doc, change, lines: change.rabLines };
  }

  private async persistLines(
    projectId: string,
    doc: LeanRab,
    change: LeanRabChange | null,
    lines: ProjectRabLine[],
  ): Promise<ProjectRabOutDto> {
    if (change) {
      const updated = await projectRabChangeService.saveRabLinesInDraft(
        projectId,
        lines,
      );
      return this.toOut({ ...doc, lines: updated.rabLines }, updated);
    }
    const updated = (await ProjectRabRepo.findOneAndUpdate(
      { _id: doc._id },
      { $set: { lines } },
    )) as LeanRab | null;
    if (!updated) throw new Error("Failed to update RAB");
    return this.toOut(updated, null);
  }

  private async requireRab(projectId: string): Promise<LeanRab> {
    const doc = (await ProjectRabRepo.model
      .findOne({ projectId: new Types.ObjectId(projectId) })
      .lean()
      .exec()) as LeanRab | null;
    if (!doc) throw new Error("RAB not found");
    return doc;
  }

  private async toOut(
    doc: LeanRab,
    change: LeanRabChange | null,
  ): Promise<ProjectRabOutDto> {
    const asOf = todayYmdUtc();
    const itemIds = [
      ...new Set(doc.lines.map((l) => String(l.materialItemId))),
    ];

    const userIds = [
      ...new Set(
        [
          doc.lockedBy ? String(doc.lockedBy) : null,
          change ? String(change.openedBy) : null,
          ...doc.lines.map((l) => (l.addedBy ? String(l.addedBy) : null)),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    const [names, refs] = await Promise.all([
      userEmailsById(userIds),
      userRefsById(userIds),
    ]);
    const drawingNames = await shopDrawingItemNames(
      doc.lines.flatMap((l) =>
        l.shopDrawingItemId ? [String(l.shopDrawingItemId)] : [],
      ),
    );

    const userRef = (id: string | null): ProjectRabUserRefOutDto | null => {
      if (!id) return null;
      return (
        refs.get(id) ?? {
          id,
          name: names.get(id) ?? id,
          profilePicture: null,
        }
      );
    };

    const [{ items: itemMeta, uoms: uomMeta }, withTarif] = await Promise.all([
      loadItemMeta(itemIds),
      itemTarifService.itemIdsWithTarifAsOf(itemIds, asOf),
    ]);
    for (const [id, meta] of itemMeta) meta.hasTarif = withTarif.has(id);

    const status = doc.status ?? "draft";
    const changeDraftOpen = Boolean(change);
    const lineOuts: ProjectRabLineOutDto[] = doc.lines.map((line) => {
      const materialItemId = String(line.materialItemId);
      const itemUomId = String(line.itemUomId);
      const item = itemMeta.get(materialItemId) ?? {
        code: "—",
        name: "Unknown",
        hasTarif: false,
      };
      const uom = uomMeta.get(itemUomId) ?? { symbol: "—", name: "—" };
      const unitPrice = line.unitPrice ?? null;
      const origin = line.origin ?? null;
      const drawingId = line.shopDrawingItemId
        ? String(line.shopDrawingItemId)
        : null;
      return {
        key: line.key,
        materialItemId,
        materialCode: item.code,
        materialName: item.name,
        itemUomId,
        uomSymbol: uom.symbol,
        uomName: uom.name,
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
        hasTarif: item.hasTarif === true,
        origin,
        addedAt: line.addedAt ? line.addedAt.toISOString() : null,
        addedBy: userRef(line.addedBy ? String(line.addedBy) : null),
        addReason: line.addReason?.trim() ? line.addReason.trim() : null,
        priceEditable: linePriceEditable(status, changeDraftOpen),
        shopDrawingItemId: drawingId,
        shopDrawingItemName: drawingId
          ? (drawingNames.get(drawingId) ?? "—")
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

    lineOuts.sort((a, b) => {
      // Labour on the same drawing: process order first.
      if (
        a.origin === "labour" &&
        b.origin === "labour" &&
        a.shopDrawingItemId &&
        a.shopDrawingItemId === b.shopDrawingItemId
      ) {
        const sa = a.sequence ?? 9999;
        const sb = b.sequence ?? 9999;
        if (sa !== sb) return sa - sb;
      }
      const byCode = a.materialCode.localeCompare(b.materialCode);
      if (byCode !== 0) return byCode;
      const byName = a.materialName.localeCompare(b.materialName);
      if (byName !== 0) return byName;
      return a.uomSymbol.localeCompare(b.uomSymbol);
    });

    const groupsMap = new Map<string, ProjectRabItemGroupOutDto>();
    for (const line of lineOuts) {
      let group = groupsMap.get(line.materialItemId);
      if (!group) {
        group = {
          materialItemId: line.materialItemId,
          materialCode: line.materialCode,
          materialName: line.materialName,
          hasTarif: line.hasTarif,
          lines: [],
        };
        groupsMap.set(line.materialItemId, group);
      }
      group.lines.push(line);
    }

    let changeDraft: ProjectRabChangeDraftRefOutDto | null = null;
    let baselineGrandTotal: string | null = null;
    let changeDiff: ProjectRabChangeDiffOutDto | null = null;
    let draftDetail: ProjectRabChangeDetailOutDto | null = null;
    if (change) {
      const openedBy = userRef(String(change.openedBy));
      if (openedBy) {
        changeDraft = {
          id: String(change._id),
          reason: change.reason,
          openedAt: change.openedAt.toISOString(),
          openedBy,
        };
      }
      const detail = await projectRabChangeService.describe(change);
      draftDetail = detail;
      baselineGrandTotal = detail.baselineGrandTotal;
      changeDiff = {
        lineDiff: detail.lineDiff.map((d) => ({
          key: d.key,
          kind: d.kind,
          materialName: d.materialName,
          oldTotalQty: d.oldTotalQty,
          newTotalQty: d.newTotalQty,
          oldUnitPrice: d.oldUnitPrice,
          newUnitPrice: d.newUnitPrice,
        })),
        boqDiff: detail.boqDiff,
        versionDiff: detail.versionDiff,
        boqMaterialDiff: detail.boqMaterialDiff,
      };
    }

    const currentRevision =
      await projectRabChangeService.latestCommittedRevision(
        String(doc.projectId),
      );
    const materialChanges =
      status === "locked"
        ? await projectRabChangeService.materialChangeHistory(
            String(doc.projectId),
            draftDetail,
          )
        : [];

    return {
      id: String(doc._id),
      projectId: String(doc.projectId),
      status,
      lockedAt: doc.lockedAt ? doc.lockedAt.toISOString() : null,
      lockedBy: userRef(doc.lockedBy ? String(doc.lockedBy) : null),
      changeDraft,
      currentRevision,
      baselineGrandTotal,
      changeDiff,
      materialChanges,
      groups: [...groupsMap.values()],
      ...rabTotalsWithCharges(
        sumGrandTotal(lineOuts.map((l) => l.lineTotal)),
        chargesFor(doc, change),
      ),
    };
  }
}

export const projectRabService = new ProjectRabService();
