import { Types } from "mongoose";
import type {
  ProjectShopDrawingBoqBaseOutDto,
  ProjectShopDrawingBoqItemSummaryOutDto,
  ProjectShopDrawingBoqLineOutDto,
  ProjectShopDrawingBoqMaterialOutDto,
  ProjectShopDrawingBoqOutDto,
  ShopDrawingBoqBaseIn,
  ShopDrawingBoqLineIn,
  UpsertShopDrawingBoqIn,
} from "../../dto/projectShopDrawingBoq.dto";
import {
  ProjectShopDrawingBoqRepo,
  type ProjectShopDrawingBoqBase,
  type ProjectShopDrawingBoqInterface,
  type ProjectShopDrawingBoqLine,
  type ShopDrawingBoqFinishPlacement,
  type ShopDrawingBoqMountingType,
} from "../../models/projectShopDrawingBoq/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument/projectShopDrawingDocument.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem/projectShopDrawingItem.model";
import { ItemUomRepo } from "../../models/itemUom/itemUom.model";
import {
  formatDecimal,
  parsePositiveDecimal,
} from "../itemMaster/itemUomConvert";
import { itemMasterService } from "../itemMaster/itemMaster.service";
import { itemUomService } from "../itemMaster/itemUom.service";
import { uomService } from "../uom/uom.service";
import { assertProjectExists } from "./projectShared";

type LeanFile = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  itemId: Types.ObjectId;
  version: number;
  isCurrent: boolean;
  originalFilename: string;
  isDeleted?: boolean;
};

type LeanItem = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  isDeleted?: boolean;
};

type StoredLine = ProjectShopDrawingBoqLine;
type StoredBase = ProjectShopDrawingBoqBase;

type LeanBoq = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  shopDrawingItemId: Types.ObjectId;
  shopDrawingFileId: Types.ObjectId;
  makeQty: string;
  main?: ProjectShopDrawingBoqInterface["main"];
  lighting?: ProjectShopDrawingBoqInterface["lighting"];
  mounting?: ProjectShopDrawingBoqInterface["mounting"];
  other?: ProjectShopDrawingBoqInterface["other"];
  lines?: unknown;
};

function snapshotFromLine(line: StoredLine): {
  formula: string;
  inputs: { v1: string; v2?: string; v3?: string };
  qtyPerUnit: string;
} {
  if (line.formula && line.inputs?.v1) {
    const inputs: { v1: string; v2?: string; v3?: string } = {
      v1: line.inputs.v1,
    };
    if (line.inputs.v2 !== undefined) inputs.v2 = line.inputs.v2;
    if (line.inputs.v3 !== undefined) inputs.v3 = line.inputs.v3;
    return {
      formula: line.formula,
      inputs,
      qtyPerUnit: line.qtyPerUnit,
    };
  }
  return {
    formula: "v1",
    inputs: { v1: line.qtyPerUnit },
    qtyPerUnit: line.qtyPerUnit,
  };
}

function emptyMain(): ProjectShopDrawingBoqInterface["main"] {
  return { parts: [], assembly: { lines: [] } };
}

function emptyLighting(): ProjectShopDrawingBoqInterface["lighting"] {
  return { lines: [] };
}

function emptyMounting(): ProjectShopDrawingBoqInterface["mounting"] {
  return { type: "mounted", lines: [] };
}

function emptyOther(): ProjectShopDrawingBoqInterface["other"] {
  return { lines: [] };
}

function isStructuredBoq(boq: LeanBoq): boolean {
  if (boq.main === undefined || boq.main === null) return false;
  // New shape has bases[]; older nested docs without bases are treated as empty.
  const first = boq.main.parts?.[0] as { bases?: unknown } | undefined;
  return first === undefined || Array.isArray(first.bases) || boq.main.parts.length === 0;
}

export class ProjectShopDrawingBoqService {
  async listMaterials(
    projectId: string,
  ): Promise<ProjectShopDrawingBoqMaterialOutDto[]> {
    await assertProjectExists(projectId);
    const items = await itemMasterService.listActiveItems();
    const result: ProjectShopDrawingBoqMaterialOutDto[] = [];
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

  async summary(
    projectId: string,
  ): Promise<ProjectShopDrawingBoqItemSummaryOutDto[]> {
    await assertProjectExists(projectId);

    const items = (await ProjectShopDrawingItemRepo.model
      .find({ projectId, isDeleted: false })
      .sort({ name: 1 })
      .lean()
      .exec()) as LeanItem[];

    const files = (await ProjectShopDrawingDocumentRepo.model
      .find({ projectId, isDeleted: { $ne: true } })
      .sort({ version: -1 })
      .lean()
      .exec()) as LeanFile[];

    const boqs = await ProjectShopDrawingBoqRepo.model
      .find({ projectId })
      .select({ shopDrawingFileId: 1 })
      .lean()
      .exec();
    const boqFileIds = new Set(boqs.map((b) => String(b.shopDrawingFileId)));

    return items.map((item) => {
      const itemId = String(item._id);
      const versions = files
        .filter((f) => String(f.itemId) === itemId)
        .map((f) => ({
          fileId: String(f._id),
          version: f.version,
          originalFilename: f.originalFilename,
          isCurrent: Boolean(f.isCurrent),
          hasBoq: boqFileIds.has(String(f._id)),
        }));
      return { itemId, name: item.name, versions };
    });
  }

  async get(
    projectId: string,
    shopDrawingItemId: string,
    shopDrawingFileId: string,
  ): Promise<ProjectShopDrawingBoqOutDto | null> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(shopDrawingItemId)) {
      throw new Error("Invalid shopDrawingItemId");
    }
    if (!Types.ObjectId.isValid(shopDrawingFileId)) {
      throw new Error("Invalid shopDrawingFileId");
    }

    const boq = (await ProjectShopDrawingBoqRepo.model
      .findOne({ projectId, shopDrawingItemId, shopDrawingFileId })
      .lean()
      .exec()) as LeanBoq | null;
    if (!boq) return null;
    return this.toOut(boq);
  }

  async upsert(
    projectId: string,
    input: UpsertShopDrawingBoqIn,
  ): Promise<ProjectShopDrawingBoqOutDto> {
    await assertProjectExists(projectId);

    const item = (await ProjectShopDrawingItemRepo.model
      .findOne({
        _id: input.shopDrawingItemId,
        projectId,
        isDeleted: false,
      })
      .lean()
      .exec()) as LeanItem | null;
    if (!item) throw new Error("ShopDrawing item not found");

    const file = (await ProjectShopDrawingDocumentRepo.model
      .findOne({
        _id: input.shopDrawingFileId,
        projectId,
        itemId: input.shopDrawingItemId,
        isDeleted: { $ne: true },
      })
      .lean()
      .exec()) as LeanFile | null;
    if (!file) throw new Error("ShopDrawing file version not found");

    const main = {
      parts: await Promise.all(
        input.main.parts.map(async (part) => ({
          key: part.key,
          ...(part.label ? { label: part.label } : {}),
          bases: await this.resolveBases(part.bases),
        })),
      ),
      assembly: {
        lines: await this.resolveLines(input.main.assembly.lines),
      },
    };

    const lighting = {
      lines: await this.resolveLines(input.lighting.lines),
    };
    const mounting = {
      type: input.mounting.type,
      lines: await this.resolveLines(input.mounting.lines),
    };
    const other = {
      lines: await this.resolveLines(input.other.lines),
    };

    const existing = await ProjectShopDrawingBoqRepo.model
      .findOne({ shopDrawingFileId: input.shopDrawingFileId })
      .lean()
      .exec();

    const setDoc = {
      projectId: new Types.ObjectId(projectId),
      shopDrawingItemId: new Types.ObjectId(input.shopDrawingItemId),
      shopDrawingFileId: new Types.ObjectId(input.shopDrawingFileId),
      makeQty: input.makeQty,
      main,
      lighting,
      mounting,
      other,
    };

    if (existing) {
      await ProjectShopDrawingBoqRepo.findByIdAndUpdate(String(existing._id), {
        $set: setDoc,
        $unset: { lines: 1 },
      });
      const fresh = (await ProjectShopDrawingBoqRepo.model
        .findById(String(existing._id))
        .lean()
        .exec()) as LeanBoq | null;
      if (!fresh) throw new Error("BOQ not found");
      return this.toOut(fresh);
    }

    const created = await ProjectShopDrawingBoqRepo.create(setDoc);
    const fresh = (await ProjectShopDrawingBoqRepo.model
      .findById(String(created._id))
      .lean()
      .exec()) as LeanBoq | null;
    if (!fresh) throw new Error("BOQ created but not found");
    return this.toOut(fresh);
  }

  async hardDelete(projectId: string, boqId: string): Promise<void> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(boqId)) throw new Error("Invalid BOQ id");
    const removed = await ProjectShopDrawingBoqRepo.deleteOne({
      _id: boqId,
      projectId,
    });
    if (!removed) throw new Error("BOQ not found");
  }

  private async resolveLines(
    lines: ShopDrawingBoqLineIn[],
  ): Promise<StoredLine[]> {
    const result: StoredLine[] = [];
    for (const line of lines) {
      result.push(await this.resolveOneLine(line));
    }
    return result;
  }

  private async resolveBases(
    bases: ShopDrawingBoqBaseIn[],
  ): Promise<StoredBase[]> {
    const result: StoredBase[] = [];
    for (const base of bases) {
      const resolved = await this.resolveOneLine(base);
      const finishings = await Promise.all(
        base.finishings.map(async (finishing) => ({
          finishingOrder: finishing.finishingOrder,
          placement: finishing.placement,
          lines: await this.resolveLines(finishing.lines),
        })),
      );
      result.push({
        key: base.key,
        ...resolved,
        ...(base.spec ? { spec: base.spec } : {}),
        finishings,
      });
    }
    return result;
  }

  private async resolveOneLine(line: ShopDrawingBoqLineIn): Promise<StoredLine> {
    const material = await itemMasterService.getActiveById(line.materialItemId);
    if (!material) {
      throw new Error("Material must be an active item master item");
    }
    const itemUom = await ItemUomRepo.model
      .findOne({
        _id: line.itemUomId,
        itemId: line.materialItemId,
      })
      .lean()
      .exec();
    if (!itemUom) {
      throw new Error("UOM must belong to the selected material");
    }
    const qtyPerUnit = uomService.calculateQty(line.formula, line.inputs);
    return {
      materialItemId: new Types.ObjectId(line.materialItemId),
      itemUomId: new Types.ObjectId(line.itemUomId),
      formula: line.formula,
      inputs: line.inputs,
      qtyPerUnit,
    };
  }

  private async toLineOut(
    line: StoredLine,
    makeQty: string,
  ): Promise<ProjectShopDrawingBoqLineOutDto> {
    const material = await itemMasterService.getById(
      String(line.materialItemId),
    );
    const uoms = await itemUomService.listByItem(String(line.materialItemId));
    const uom = uoms.find((u) => u.id === String(line.itemUomId));
    const snap = snapshotFromLine(line);
    const qty = parsePositiveDecimal(snap.qtyPerUnit, "qtyPerUnit");
    const make = parsePositiveDecimal(makeQty, "makeQty");
    return {
      materialItemId: String(line.materialItemId),
      materialCode: material?.itemId ?? "—",
      materialName: material?.name ?? "Unknown",
      itemUomId: String(line.itemUomId),
      uomSymbol: uom?.symbol ?? "—",
      uomName: uom?.name ?? "—",
      formula: snap.formula,
      inputs: snap.inputs,
      qtyPerUnit: snap.qtyPerUnit,
      totalQty: formatDecimal(qty.mul(make)),
    };
  }

  private async toBaseOut(
    base: StoredBase,
    makeQty: string,
  ): Promise<ProjectShopDrawingBoqBaseOutDto> {
    const out = await this.toLineOut(base, makeQty);
    return {
      ...out,
      key: base.key,
      ...(base.spec ? { spec: base.spec } : {}),
      finishings: await Promise.all(
        (base.finishings ?? []).map(async (finishing) => ({
          finishingOrder: finishing.finishingOrder,
          placement: finishing.placement as ShopDrawingBoqFinishPlacement,
          lines: await Promise.all(
            finishing.lines.map((line) => this.toLineOut(line, makeQty)),
          ),
        })),
      ),
    };
  }

  private async toOut(boq: LeanBoq): Promise<ProjectShopDrawingBoqOutDto> {
    const item = (await ProjectShopDrawingItemRepo.model
      .findById(boq.shopDrawingItemId)
      .lean()
      .exec()) as LeanItem | null;
    const file = (await ProjectShopDrawingDocumentRepo.model
      .findById(boq.shopDrawingFileId)
      .lean()
      .exec()) as LeanFile | null;

    const structured = isStructuredBoq(boq);
    const main = structured && boq.main ? boq.main : emptyMain();
    const lighting =
      structured && boq.lighting ? boq.lighting : emptyLighting();
    const mounting =
      structured && boq.mounting ? boq.mounting : emptyMounting();
    const other = structured && boq.other ? boq.other : emptyOther();

    const parts = Array.isArray(main.parts) ? main.parts : [];
    const assemblyLines = Array.isArray(main.assembly?.lines)
      ? main.assembly.lines
      : [];
    const mainOut = {
      parts: await Promise.all(
        parts.map(async (part) => {
          const bases = Array.isArray(part.bases) ? part.bases : [];
          return {
            key: part.key,
            ...(part.label ? { label: part.label } : {}),
            bases: await Promise.all(
              bases.map((base) => this.toBaseOut(base, boq.makeQty)),
            ),
          };
        }),
      ),
      assembly: {
        lines: await Promise.all(
          assemblyLines.map((line) => this.toLineOut(line, boq.makeQty)),
        ),
      },
    };

    return {
      id: String(boq._id),
      projectId: String(boq.projectId),
      shopDrawingItemId: String(boq.shopDrawingItemId),
      shopDrawingItemName: item?.name ?? "—",
      shopDrawingFileId: String(boq.shopDrawingFileId),
      fileVersion: file?.version ?? 0,
      originalFilename: file?.originalFilename ?? "—",
      makeQty: boq.makeQty,
      main: mainOut,
      lighting: {
        lines: await Promise.all(
          lighting.lines.map((line) => this.toLineOut(line, boq.makeQty)),
        ),
      },
      mounting: {
        type: (mounting.type ?? "mounted") as ShopDrawingBoqMountingType,
        lines: await Promise.all(
          mounting.lines.map((line) => this.toLineOut(line, boq.makeQty)),
        ),
      },
      other: {
        lines: await Promise.all(
          other.lines.map((line) => this.toLineOut(line, boq.makeQty)),
        ),
      },
      warnings: [],
    };
  }
}

export const projectShopDrawingBoqService = new ProjectShopDrawingBoqService();
