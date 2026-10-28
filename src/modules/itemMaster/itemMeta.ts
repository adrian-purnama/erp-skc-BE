import { Types } from "mongoose";
import { ItemRepo } from "../../models/item/item.model";
import { itemUomService } from "./itemUom.service";

export type ItemMeta = {
  code: string;
  name: string;
  hasTarif?: boolean;
};

export type UomMeta = {
  symbol: string;
  name: string;
};

/** Item code/name plus its UoM symbols, keyed by Mongo id (three queries total). */
export async function loadItemMeta(ids: string[]): Promise<{
  items: Map<string, ItemMeta>;
  uoms: Map<string, UomMeta>;
}> {
  const items = new Map<string, ItemMeta>();
  const uoms = new Map<string, UomMeta>();
  const unique = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
  if (unique.length === 0) return { items, uoms };

  const [docs, uomsByItem] = await Promise.all([
    ItemRepo.model
      .find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
      .select({ itemId: 1, name: 1 })
      .lean()
      .exec(),
    itemUomService.listByItems(unique),
  ]);
  const docById = new Map(docs.map((d) => [String(d._id), d]));
  for (const id of unique) {
    const doc = docById.get(id);
    items.set(id, { code: doc?.itemId ?? "—", name: doc?.name ?? "Unknown" });
  }
  for (const list of uomsByItem.values()) {
    for (const uom of list) {
      uoms.set(uom.id, { symbol: uom.symbol, name: uom.name });
    }
  }
  return { items, uoms };
}
