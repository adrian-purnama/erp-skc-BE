import { Types } from "mongoose";
import type {
  ProjectRabElaborationBlockOutDto,
  ProjectRabElaborationDocOutDto,
  ProjectRabElaborationLineOutDto,
  ProjectRabElaborationOutDto,
  ProjectRabItemGroupOutDto,
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
import { itemTarifService } from "../itemMaster/itemTarif.service";
import { itemUomService } from "../itemMaster/itemUom.service";
import { assertProjectExists } from "./projectShared";
import { projectShopDrawingBoqService } from "./projectShopDrawingBoq.service";
import { userNamesById } from "./versionedProjectFile.service";
import {
  aggregateBoqLinesToRab,
  computeLineTotal,
  mergeRabPricing,
  planLockedAppends,
  sumGrandTotal,
  type RabAggSourceLine,
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

function pushLine(
  out: RabAggSourceLine[],
  line: ProjectShopDrawingBoqLine | undefined,
  makeQty: string,
): void {
  if (!line?.materialItemId || !line?.itemUomId || !line.qtyPerUnit) return;
  out.push({
    materialItemId: String(line.materialItemId),
    itemUomId: String(line.itemUomId),
    qtyPerUnit: line.qtyPerUnit,
    makeQty,
  });
}

function collectSourceLines(boqs: LeanBoq[]): RabAggSourceLine[] {
  const out: RabAggSourceLine[] = [];
  for (const boq of boqs) {
    const makeQty = boq.makeQty;
    for (const part of boq.main?.parts ?? []) {
      for (const base of part.bases ?? []) {
        pushLine(out, base, makeQty);
        for (const finishing of base.finishings ?? []) {
          for (const line of finishing.lines ?? []) {
            pushLine(out, line, makeQty);
          }
        }
      }
    }
    for (const line of boq.main?.assembly?.lines ?? []) {
      pushLine(out, line, makeQty);
    }
    for (const line of boq.lighting?.lines ?? []) {
      pushLine(out, line, makeQty);
    }
    for (const line of boq.mounting?.lines ?? []) {
      pushLine(out, line, makeQty);
    }
    for (const line of boq.other?.lines ?? []) {
      pushLine(out, line, makeQty);
    }
  }
  return out;
}

function linePriceEditable(
  status: ProjectRabInterface["status"],
  origin: ProjectRabLine["origin"],
): boolean {
  if (status !== "locked") return true;
  return origin === "append";
}

function toElabLine(
  line: ProjectShopDrawingBoqLineOutDto,
  makeQty: string,
): ProjectRabElaborationLineOutDto {
  return {
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
    const boqs = (await ProjectShopDrawingBoqRepo.model
      .find({ projectId: projectOid })
      .lean()
      .exec()) as LeanBoq[];
    const scaffold = aggregateBoqLinesToRab(collectSourceLines(boqs));

    let doc = (await ProjectRabRepo.model
      .findOne({ projectId: projectOid })
      .lean()
      .exec()) as LeanRab | null;

    const status = doc?.status ?? "draft";

    if (status === "locked" && doc) {
      const existingKeys = new Set(doc.lines.map((l) => l.key));
      const toAppend = planLockedAppends(existingKeys, scaffold);
      if (toAppend.length > 0) {
        const now = new Date();
        const userOid = new Types.ObjectId(userId);
        const lines: ProjectRabLine[] = [
          ...doc.lines,
          ...toAppend.map((row) => ({
            key: row.key,
            materialItemId: new Types.ObjectId(row.materialItemId),
            itemUomId: new Types.ObjectId(row.itemUomId),
            totalQty: row.totalQty,
            origin: "append" as const,
            addedAt: now,
            addedBy: userOid,
          })),
        ];
        doc = (await ProjectRabRepo.findOneAndUpdate(
          { _id: doc._id },
          { $set: { lines } },
        )) as LeanRab | null;
        if (!doc) throw new Error("Failed to append RAB lines");
      }
      return this.toOut(doc);
    }

    // Draft: live qty from BOQ; persist scaffold + prices
    if (scaffold.length === 0) {
      if (!doc) return null;
      if (doc.lines.length > 0) {
        doc = (await ProjectRabRepo.findOneAndUpdate(
          { _id: doc._id },
          { $set: { lines: [], status: "draft" } },
        )) as LeanRab | null;
        if (!doc) return null;
      }
      return this.toOut(doc);
    }

    const previous = (doc?.lines ?? []).map((line) => ({
      key: line.key,
      unitPrice: line.unitPrice,
      tarifId: line.tarifId ? String(line.tarifId) : undefined,
    }));
    const merged = mergeRabPricing(scaffold, previous);
    const lines: ProjectRabLine[] = merged.map((row) => {
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
    return this.toOut(doc);
  }

  async elaboration(projectId: string): Promise<ProjectRabElaborationOutDto> {
    await assertProjectExists(projectId);
    const projectOid = new Types.ObjectId(projectId);
    const boqs = (await ProjectShopDrawingBoqRepo.model
      .find({ projectId: projectOid })
      .select({ shopDrawingItemId: 1, shopDrawingFileId: 1 })
      .lean()
      .exec()) as Array<{
      shopDrawingItemId: Types.ObjectId;
      shopDrawingFileId: Types.ObjectId;
    }>;

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
      throw new Error("Add Shop Drawing BOQ materials before locking RAB");
    }

    const doc = await this.requireRab(projectId);
    if (doc.status === "locked") {
      throw new Error("RAB is already locked");
    }
    if (doc.lines.length === 0) {
      throw new Error("RAB has no lines to lock");
    }

    const now = new Date();
    const userOid = new Types.ObjectId(userId);
    const lines: ProjectRabLine[] = doc.lines.map((l) => ({
      ...l,
      origin: "lock",
      addedAt: now,
      addedBy: userOid,
    }));

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
    return this.toOut(updated);
  }

  async fillTarif(
    projectId: string,
    lineKey: string,
  ): Promise<ProjectRabOutDto> {
    await assertProjectExists(projectId);
    const doc = await this.requireRab(projectId);
    const idx = doc.lines.findIndex((l) => l.key === lineKey);
    if (idx < 0) throw new Error("RAB line not found");

    const line = doc.lines[idx]!;
    if (!linePriceEditable(doc.status, line.origin)) {
      throw new Error("Locked RAB lines cannot be edited");
    }

    const tarif = await itemTarifService.resolveAsOf(
      String(line.materialItemId),
      todayYmdUtc(),
    );
    if (!tarif) {
      throw new Error("No current tarif for this item");
    }

    const lines = doc.lines.map((l, i) =>
      i === idx
        ? {
            ...l,
            unitPrice: tarif.amount,
            tarifId: new Types.ObjectId(tarif.id),
          }
        : l,
    );

    return this.saveLines(doc._id, lines);
  }

  async patchLinePrice(
    projectId: string,
    lineKey: string,
    unitPrice: string | null,
  ): Promise<ProjectRabOutDto> {
    await assertProjectExists(projectId);
    const doc = await this.requireRab(projectId);
    const idx = doc.lines.findIndex((l) => l.key === lineKey);
    if (idx < 0) throw new Error("RAB line not found");

    const line = doc.lines[idx]!;
    if (!linePriceEditable(doc.status, line.origin)) {
      throw new Error("Locked RAB lines cannot be edited");
    }

    const lines = doc.lines.map((l, i) => {
      if (i !== idx) return l;
      const next: ProjectRabLine = {
        key: l.key,
        materialItemId: l.materialItemId,
        itemUomId: l.itemUomId,
        totalQty: l.totalQty,
        ...(l.origin ? { origin: l.origin } : {}),
        ...(l.addedAt ? { addedAt: l.addedAt } : {}),
        ...(l.addedBy ? { addedBy: l.addedBy } : {}),
      };
      if (unitPrice !== null && unitPrice !== "") {
        next.unitPrice = unitPrice;
      }
      return next;
    });

    return this.saveLines(doc._id, lines);
  }

  private async saveLines(
    id: Types.ObjectId,
    lines: ProjectRabLine[],
  ): Promise<ProjectRabOutDto> {
    const updated = (await ProjectRabRepo.findOneAndUpdate(
      { _id: id },
      { $set: { lines } },
    )) as LeanRab | null;
    if (!updated) throw new Error("Failed to update RAB");
    return this.toOut(updated);
  }

  private async requireRab(projectId: string): Promise<LeanRab> {
    const doc = (await ProjectRabRepo.model
      .findOne({ projectId: new Types.ObjectId(projectId) })
      .lean()
      .exec()) as LeanRab | null;
    if (!doc) throw new Error("RAB not found");
    return doc;
  }

  private async toOut(doc: LeanRab): Promise<ProjectRabOutDto> {
    const asOf = todayYmdUtc();
    const itemIds = [
      ...new Set(doc.lines.map((l) => String(l.materialItemId))),
    ];

    const userIds = [
      ...new Set(
        [
          doc.lockedBy ? String(doc.lockedBy) : null,
          ...doc.lines.map((l) => (l.addedBy ? String(l.addedBy) : null)),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
    const names = await userNamesById(userIds);

    const userRef = (id: string | null): ProjectRabUserRefOutDto | null => {
      if (!id) return null;
      return { id, name: names.get(id) ?? id };
    };

    const itemMeta = new Map<
      string,
      { code: string; name: string; hasTarif: boolean }
    >();
    await Promise.all(
      itemIds.map(async (id) => {
        const [item, tarif] = await Promise.all([
          itemMasterService.getById(id),
          itemTarifService.resolveAsOf(id, asOf),
        ]);
        itemMeta.set(id, {
          code: item?.itemId ?? "—",
          name: item?.name ?? "Unknown",
          hasTarif: tarif !== null,
        });
      }),
    );

    const uomMeta = new Map<string, { symbol: string; name: string }>();
    await Promise.all(
      itemIds.map(async (id) => {
        const uoms = await itemUomService.listByItem(id);
        for (const u of uoms) {
          uomMeta.set(u.id, { symbol: u.symbol, name: u.name });
        }
      }),
    );

    const status = doc.status ?? "draft";
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
        hasTarif: item.hasTarif,
        origin,
        addedAt: line.addedAt ? line.addedAt.toISOString() : null,
        addedBy: userRef(line.addedBy ? String(line.addedBy) : null),
        priceEditable: linePriceEditable(status, line.origin),
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

    return {
      id: String(doc._id),
      projectId: String(doc.projectId),
      status,
      lockedAt: doc.lockedAt ? doc.lockedAt.toISOString() : null,
      lockedBy: userRef(doc.lockedBy ? String(doc.lockedBy) : null),
      groups: [...groupsMap.values()],
      grandTotal: sumGrandTotal(lineOuts.map((l) => l.lineTotal)),
    };
  }
}

export const projectRabService = new ProjectRabService();
