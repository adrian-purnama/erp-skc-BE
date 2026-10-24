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
} from "../../dto/projectRab.dto";
import type {
  ProjectShopDrawingBoqLineOutDto,
  ProjectShopDrawingBoqOutDto,
} from "../../dto/projectShopDrawingBoq.dto";
import {
  ProjectRabRepo,
  type ProjectRabInterface,
  type ProjectRabLine,
} from "../../models/projectRab/projectRab.model";
import {
  ProjectShopDrawingBoqRepo,
  type ProjectShopDrawingBoqLine,
} from "../../models/projectShopDrawingBoq/projectShopDrawingBoq.model";
import { todayYmdUtc } from "../../validation/itemMaster";
import { itemMasterService } from "../itemMaster/itemMaster.service";
import { loadItemMeta } from "../itemMaster/itemMeta";
import { itemTarifService } from "../itemMaster/itemTarif.service";
import { itemUomService } from "../itemMaster/itemUom.service";
import { liveCurrentFiles } from "./projectCurrentFiles";
import { filterCountedBoqs } from "./projectRabChange.planner";
import {
  projectRabChangeService,
  type LeanRabChange,
} from "./projectRabChange.service";
import { assertProjectExists } from "./projectShared";
import { projectShopDrawingBoqService } from "./projectShopDrawingBoq.service";
import { userEmailsById } from "../../utils/shared";
import {
  aggregateBoqLinesToRab,
  assertAllLinesPriced,
  collectSourceLines,
  computeLineTotal,
  isLabourLine,
  mergeRabPricing,
  sumGrandTotal,
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
    const [allBoqs, currentFiles] = await Promise.all([
      ProjectShopDrawingBoqRepo.model
        .find({ projectId: projectOid })
        .lean()
        .exec() as Promise<Array<LeanBoq & { shopDrawingFileId: Types.ObjectId }>>,
      liveCurrentFiles(projectId),
    ]);
    // Only each item's current file version feeds the RAB.
    const boqs = filterCountedBoqs(allBoqs, currentFiles);
    const scaffold = aggregateBoqLinesToRab(collectSourceLines(boqs));

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
      }));
    const merged = mergeRabPricing(scaffold, previous);
    const boqLines: ProjectRabLine[] = merged.map((row) => {
      const line: ProjectRabLine = {
        key: row.key,
        materialItemId: new Types.ObjectId(row.materialItemId),
        itemUomId: new Types.ObjectId(row.itemUomId),
        totalQty: row.totalQty,
      };
      if (row.unitPrice) line.unitPrice = row.unitPrice;
      if (row.tarifId && Types.ObjectId.isValid(row.tarifId)) {
        line.tarifId = new Types.ObjectId(row.tarifId);
      }
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

    const documents: ProjectRabElaborationDocOutDto[] = [];
    for (const row of boqs) {
      const out = await projectShopDrawingBoqService.get(
        projectId,
        String(row.shopDrawingItemId),
        String(row.shopDrawingFileId),
      );
      if (!out) continue;
      documents.push(boqToElaborationDoc(out));
    }

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

    const lines = working.map((l, i) =>
      i === idx
        ? {
            ...l,
            unitPrice: tarif.amount,
            tarifId: new Types.ObjectId(tarif.id),
          }
        : l,
    );

    return this.persistLines(projectId, doc, change, lines);
  }

  async listLabourItems(
    projectId: string,
  ): Promise<ProjectRabLabourItemOutDto[]> {
    await assertProjectExists(projectId);
    const items = await itemMasterService.listActiveItems("labour");
    const result: ProjectRabLabourItemOutDto[] = [];
    for (const item of items) {
      const uoms = await itemUomService.listByItem(item.id);
      result.push({
        id: item.id,
        itemId: item.itemId,
        name: item.name,
        description: item.description,
        baseUomId: item.baseUomId,
        uoms,
      });
    }
    return result;
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

    const key = `${input.itemId}:${input.itemUomId}`;
    const projectOid = new Types.ObjectId(projectId);
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
      throw new Error("This labour item and UOM are already on the RAB");
    }

    const now = new Date();
    const userOid = new Types.ObjectId(userId);
    const labourLine: ProjectRabLine = {
      key,
      materialItemId: new Types.ObjectId(input.itemId),
      itemUomId: new Types.ObjectId(input.itemUomId),
      totalQty: input.totalQty,
      origin: "labour",
      addedAt: now,
      addedBy: userOid,
    };
    if (input.unitPrice !== undefined && input.unitPrice !== null) {
      labourLine.unitPrice = input.unitPrice;
    }

    return this.persistLines(projectId, doc, change, [
      ...working,
      labourLine,
    ]);
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
    const lines = working.filter((l) => l.key !== lineKey);
    return this.persistLines(projectId, doc, change, lines);
  }

  async patchLinePrice(
    projectId: string,
    lineKey: string,
    unitPrice: string | null,
  ): Promise<ProjectRabOutDto> {
    await assertProjectExists(projectId);
    const { doc, change, lines: working } = await this.requireEditableLines(
      projectId,
    );
    const idx = working.findIndex((l) => l.key === lineKey);
    if (idx < 0) throw new Error("RAB line not found");

    const lines = working.map((l, i) => {
      if (i !== idx) return l;
      const next: ProjectRabLine = {
        key: l.key,
        materialItemId: l.materialItemId,
        itemUomId: l.itemUomId,
        totalQty: l.totalQty,
        ...(l.origin ? { origin: l.origin } : {}),
        ...(l.addedAt ? { addedAt: l.addedAt } : {}),
        ...(l.addedBy ? { addedBy: l.addedBy } : {}),
        ...(l.addReason ? { addReason: l.addReason } : {}),
      };
      if (unitPrice !== null && unitPrice !== "") {
        next.unitPrice = unitPrice;
      }
      return next;
    });

    return this.persistLines(projectId, doc, change, lines);
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
    const names = await userEmailsById(userIds);

    const userRef = (id: string | null): ProjectRabUserRefOutDto | null => {
      if (!id) return null;
      return { id, name: names.get(id) ?? id };
    };

    const { items: itemMeta, uoms: uomMeta } = await loadItemMeta(itemIds);
    await Promise.all(
      itemIds.map(async (id) => {
        const tarif = await itemTarifService.resolveAsOf(id, asOf);
        const meta = itemMeta.get(id);
        if (meta) meta.hasTarif = tarif !== null;
      }),
    );

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
      return {
        key: line.key,
        materialItemId,
        materialCode: item.code,
        materialName: item.name,
        itemUomId,
        uomSymbol: uom.symbol,
        uomName: uom.name,
        totalQty: line.totalQty,
        unitPrice,
        tarifId: line.tarifId ? String(line.tarifId) : null,
        lineTotal: computeLineTotal(line.totalQty, unitPrice),
        hasTarif: item.hasTarif === true,
        origin,
        addedAt: line.addedAt ? line.addedAt.toISOString() : null,
        addedBy: userRef(line.addedBy ? String(line.addedBy) : null),
        addReason: line.addReason?.trim() ? line.addReason.trim() : null,
        priceEditable: linePriceEditable(status, changeDraftOpen),
      };
    });

    lineOuts.sort((a, b) => {
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
      groups: [...groupsMap.values()],
      grandTotal: sumGrandTotal(lineOuts.map((l) => l.lineTotal)),
    };
  }
}

export const projectRabService = new ProjectRabService();
