import { Types } from "mongoose";
import { ItemUomRepo } from "../../models/itemUom/itemUom.model";
import {
  UOM_DEFAULT_DECIMALS,
  UomRepo,
  type UomRoundingMode,
} from "../../models/uom/uom.model";
import {
  collectSourceLines,
  rabLineKey,
  type BoqLike,
  type RabUomPlan,
} from "./projectRab.planner";

type LeanItemUom = {
  _id: Types.ObjectId;
  itemId: Types.ObjectId;
  uomId: Types.ObjectId;
  isBase: boolean;
  conversionFactor: string | null;
};

type LeanUomRule = {
  _id: Types.ObjectId;
  decimals?: number;
  rounding?: UomRoundingMode;
};

/**
 * Build the RAB UOM plan for every material×UOM used by `boqs`: convertible
 * UOMs map to the material's base UOM; rounding comes from the target's UOM.
 */
export async function loadRabUomPlan(boqs: BoqLike[]): Promise<RabUomPlan> {
  const plan: RabUomPlan = new Map();
  const sources = collectSourceLines(boqs);
  if (sources.length === 0) return plan;

  const itemIds = [...new Set(sources.map((s) => s.materialItemId))];
  const itemUoms = (await ItemUomRepo.model
    .find({ itemId: { $in: itemIds.map((id) => new Types.ObjectId(id)) } })
    .lean()
    .exec()) as LeanItemUom[];

  const uomIds = [...new Set(itemUoms.map((r) => String(r.uomId)))];
  const uoms = (await UomRepo.model
    .find({ _id: { $in: uomIds.map((id) => new Types.ObjectId(id)) } })
    .select({ decimals: 1, rounding: 1 })
    .lean()
    .exec()) as LeanUomRule[];
  const uomById = new Map(uoms.map((u) => [String(u._id), u]));

  const byId = new Map(itemUoms.map((r) => [String(r._id), r]));
  const baseByItem = new Map(
    itemUoms.filter((r) => r.isBase).map((r) => [String(r.itemId), r]),
  );

  for (const source of sources) {
    const key = rabLineKey(source.materialItemId, source.itemUomId);
    if (plan.has(key)) continue;
    const row = byId.get(source.itemUomId);
    if (!row) continue;
    const base = baseByItem.get(source.materialItemId);
    const convertible =
      base !== undefined && row.conversionFactor != null && row.conversionFactor !== "";
    const target = convertible ? base : row;
    const uom = uomById.get(String(target.uomId));
    plan.set(key, {
      targetItemUomId: String(target._id),
      factor: convertible ? row.conversionFactor! : "1",
      rounding: {
        decimals: uom?.decimals ?? UOM_DEFAULT_DECIMALS,
        mode: uom?.rounding ?? "up",
      },
    });
  }
  return plan;
}
