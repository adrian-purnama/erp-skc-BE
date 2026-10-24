import { itemMasterService } from "./itemMaster.service";
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

/** Item code/name plus its UoM symbols, keyed by Mongo id. */
export async function loadItemMeta(ids: string[]): Promise<{
  items: Map<string, ItemMeta>;
  uoms: Map<string, UomMeta>;
}> {
  const items = new Map<string, ItemMeta>();
  const uoms = new Map<string, UomMeta>();

  await Promise.all(
    ids.map(async (id) => {
      const [item, itemUoms] = await Promise.all([
        itemMasterService.getById(id),
        itemUomService.listByItem(id),
      ]);
      items.set(id, {
        code: item?.itemId ?? "—",
        name: item?.name ?? "Unknown",
      });
      for (const uom of itemUoms) {
        uoms.set(uom.id, { symbol: uom.symbol, name: uom.name });
      }
    }),
  );

  return { items, uoms };
}
