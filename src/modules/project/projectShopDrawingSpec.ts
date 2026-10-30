import { Types } from "mongoose";
import { ItemRepo } from "../../models/item.model";
import type { ShopDrawingBoqMountingType } from "../../models/projectShopDrawingBoq.model";
import { ProjectShopDrawingBoqRepo } from "../../models/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument.model";

type SpecLine = { materialItemId?: unknown };

/** The BOQ parts that make up an item's keterangan. */
export type SpecBoq = {
  main?: {
    parts?: Array<{
      bases?: Array<
        SpecLine & {
          spec?: string;
          finishings?: Array<{ lines?: SpecLine[] }>;
        }
      >;
    }>;
    assembly?: { lines?: SpecLine[] };
  };
  lighting?: { lines?: SpecLine[] };
  mounting?: { type?: ShopDrawingBoqMountingType; lines?: SpecLine[] };
};

const MOUNTING_LABELS: Record<ShopDrawingBoqMountingType, string> = {
  mounted: "Mounted",
  hanging: "Hanging",
  pylon: "Pylon",
  blade: "Blade",
  freestanding: "Freestanding",
  other: "",
};

function uniqueNames(
  lines: Array<SpecLine & { spec?: string }>,
  nameById: Map<string, string>,
): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!line.materialItemId) continue;
    const name = nameById.get(String(line.materialItemId));
    if (!name) continue;
    const spec = line.spec?.trim();
    const label = spec ? `${name} (${spec})` : name;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * Keterangan lines from a BOQ: Finishing, Material, Assembly, Lighting,
 * Mounting — each listing its material names once. Empty sections are left out.
 */
export function buildShopDrawingSpecLines(
  boq: SpecBoq,
  nameById: Map<string, string>,
): string[] {
  const bases = (boq.main?.parts ?? []).flatMap((p) => p.bases ?? []);
  const finishings = bases.flatMap((b) =>
    (b.finishings ?? []).flatMap((f) => f.lines ?? []),
  );
  const mountingType = boq.mounting?.type
    ? MOUNTING_LABELS[boq.mounting.type]
    : "";
  const mountingNames = uniqueNames(boq.mounting?.lines ?? [], nameById);

  const lines: string[] = [];
  const push = (label: string, names: string[]) => {
    if (names.length > 0) lines.push(`${label}: ${names.join(", ")}`);
  };
  push("Finishing", uniqueNames(finishings, nameById));
  push("Material", uniqueNames(bases, nameById));
  push("Assembly", uniqueNames(boq.main?.assembly?.lines ?? [], nameById));
  push("Lighting", uniqueNames(boq.lighting?.lines ?? [], nameById));
  if (mountingNames.length > 0 || mountingType) {
    const label = mountingType ? `Mounting (${mountingType})` : "Mounting";
    lines.push(
      mountingNames.length > 0 ? `${label}: ${mountingNames.join(", ")}` : label,
    );
  }
  return lines;
}

function collectMaterialIds(boq: SpecBoq): string[] {
  const bases = (boq.main?.parts ?? []).flatMap((p) => p.bases ?? []);
  const all: SpecLine[] = [
    ...bases,
    ...bases.flatMap((b) => (b.finishings ?? []).flatMap((f) => f.lines ?? [])),
    ...(boq.main?.assembly?.lines ?? []),
    ...(boq.lighting?.lines ?? []),
    ...(boq.mounting?.lines ?? []),
  ];
  return all
    .map((l) => (l.materialItemId ? String(l.materialItemId) : ""))
    .filter((id) => Types.ObjectId.isValid(id));
}

/**
 * Keterangan per shop drawing item id, from the BOQ on each item's current
 * file. Items without a current BOQ map to an empty list.
 */
export async function loadShopDrawingSpecs(
  itemIds: Array<string | Types.ObjectId>,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const ids = [...new Set(itemIds.map(String))].filter((id) =>
    Types.ObjectId.isValid(id),
  );
  if (ids.length === 0) return out;

  const files = await ProjectShopDrawingDocumentRepo.model
    .find({
      itemId: { $in: ids.map((id) => new Types.ObjectId(id)) },
      isCurrent: true,
      isDeleted: { $ne: true },
    })
    .select({ _id: 1 })
    .lean()
    .exec();
  if (files.length === 0) return out;

  const boqs = (await ProjectShopDrawingBoqRepo.model
    .find({ shopDrawingFileId: { $in: files.map((f) => f._id) } })
    .select({ shopDrawingItemId: 1, main: 1, lighting: 1, mounting: 1 })
    .lean()
    .exec()) as Array<SpecBoq & { shopDrawingItemId: Types.ObjectId }>;

  const materialIds = [...new Set(boqs.flatMap(collectMaterialIds))];
  const items = await ItemRepo.model
    .find({ _id: { $in: materialIds.map((id) => new Types.ObjectId(id)) } })
    .select({ name: 1 })
    .lean()
    .exec();
  const nameById = new Map(items.map((i) => [String(i._id), i.name]));

  for (const boq of boqs) {
    out.set(String(boq.shopDrawingItemId), buildShopDrawingSpecLines(boq, nameById));
  }
  return out;
}
