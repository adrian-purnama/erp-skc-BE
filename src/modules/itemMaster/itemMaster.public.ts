import { Types } from "mongoose";
import { FolderRepo } from "../../models/folder.model";
import { ItemRepo, type ItemInterface } from "../../models/item.model";
import { ItemUomRepo, type ItemUomRoundingMode } from "../../models/itemUom.model";
import { getUomsByIds } from "../uom";
import { folderPathUp } from "./folderPath";

type IdLike = Types.ObjectId | string;

const toObjectIds = (ids: readonly IdLike[]) =>
  [...new Set(ids.map(String))]
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

/** An item as other modules see it (any status: documents keep old items). */
export type ItemRefDto = {
  id: string;
  code: string;
  name: string;
  itemType: ItemInterface["itemType"];
  folderId: string | null;
  vendorIds: string[];
  isActive: boolean;
};

type ItemLean = {
  _id: Types.ObjectId;
  itemId?: string;
  name: string;
  itemType: ItemInterface["itemType"];
  folderId?: Types.ObjectId | null;
  vendorIds?: Types.ObjectId[];
  isActive?: boolean;
};

/** Items by id, keyed by id. Unknown ids are absent. */
export async function getItemRefs(ids: readonly IdLike[]): Promise<Map<string, ItemRefDto>> {
  const oids = toObjectIds(ids);
  if (oids.length === 0) return new Map();
  const docs = (await ItemRepo.model
    .find({ _id: { $in: oids } })
    .select({ itemId: 1, name: 1, itemType: 1, folderId: 1, vendorIds: 1, isActive: 1 })
    .lean()
    .exec()) as ItemLean[];
  return new Map(
    docs.map((d) => [
      String(d._id),
      {
        id: String(d._id),
        code: d.itemId ?? "",
        name: d.name,
        itemType: d.itemType,
        folderId: d.folderId ? String(d.folderId) : null,
        vendorIds: (d.vendorIds ?? []).map(String),
        isActive: d.isActive !== false,
      },
    ]),
  );
}

type FolderLean = { _id: Types.ObjectId; name: string; parentId?: Types.ObjectId | null };

/** Folder names from the root down to each item's folder, keyed by item id. */
export async function getItemFolderPaths(itemIds: readonly IdLike[]): Promise<Map<string, string[]>> {
  const items = await getItemRefs(itemIds);
  const out = new Map<string, string[]>();
  if (items.size === 0) return out;
  const folders = (await FolderRepo.model.find().lean().exec()) as FolderLean[];
  const byId = new Map(folders.map((f) => [String(f._id), f]));
  for (const it of items.values()) {
    const nodes = await folderPathUp(it.folderId, async (id) => {
      const folder = byId.get(id);
      return folder
        ? { parentId: folder.parentId ? String(folder.parentId) : null, value: folder.name }
        : null;
    });
    out.set(
      it.id,
      nodes.map((node) => node.value),
    );
  }
  return out;
}

/** One item-UoM row: an item's unit and its conversion / rounding settings. */
export type ItemUomRowDto = {
  id: string;
  itemId: string;
  uomId: string;
  isBase: boolean;
  conversionFactor: string | null;
  /** Item-level decimals override, or null. */
  decimals: number | null;
  rounding: ItemUomRoundingMode | undefined;
  /** The UoM's own decimals (catalog), when the UoM exists. */
  uomDecimals: number | undefined;
};

type ItemUomLean = {
  _id: Types.ObjectId;
  itemId: Types.ObjectId;
  uomId: Types.ObjectId;
  isBase: boolean;
  conversionFactor: string | null;
  decimals?: number | null;
  rounding?: ItemUomRoundingMode;
};

/** Every UoM row of these items, in stored order (rules that pick "the first" rely on it). */
export async function getItemUomRows(itemIds: readonly IdLike[]): Promise<ItemUomRowDto[]> {
  const oids = toObjectIds(itemIds);
  if (oids.length === 0) return [];
  const rows = (await ItemUomRepo.model
    .find({ itemId: { $in: oids } })
    .lean()
    .exec()) as ItemUomLean[];
  const uoms = await getUomsByIds(rows.map((r) => String(r.uomId)));
  return rows.map((r) => ({
    id: String(r._id),
    itemId: String(r.itemId),
    uomId: String(r.uomId),
    isBase: r.isBase,
    conversionFactor: r.conversionFactor,
    decimals: r.decimals ?? null,
    rounding: r.rounding,
    uomDecimals: uoms.get(String(r.uomId))?.decimals,
  }));
}

/** Each line's UoM must be one of its material's UoMs. */
export async function assertItemUomsBelong(
  lines: ReadonlyArray<{ materialItemId: string; itemUomId: string }>,
  message = "A line has a unit that does not belong to its material",
): Promise<void> {
  const oids = toObjectIds(lines.map((l) => l.itemUomId));
  const rows = oids.length
    ? await ItemUomRepo.model.find({ _id: { $in: oids } }).select({ itemId: 1 }).lean().exec()
    : [];
  const itemByUom = new Map(rows.map((u) => [String(u._id), String(u.itemId)]));
  for (const line of lines) {
    if (itemByUom.get(line.itemUomId) !== line.materialItemId) throw new Error(message);
  }
}
