import { Types } from "mongoose";
import {
  ItemUomRepo,
  type ItemUomRoundingMode,
} from "../../models/itemUom.model";
import { UOM_DEFAULT_DECIMALS, UomRepo } from "../../models/uom.model";
import { formatDecimal, parsePositiveDecimal } from "../itemMaster/itemUomConvert";
import {
  collectSourceLines,
  rabLineKey,
  stepFromDecimals,
  type BoqLike,
  type RabRounding,
  type RabUomPlan,
} from "./projectRab.planner";

type LeanItemUom = {
  _id: Types.ObjectId;
  itemId: Types.ObjectId;
  uomId: Types.ObjectId;
  isBase: boolean;
  conversionFactor: string | null;
  decimals?: number | null;
  rounding?: ItemUomRoundingMode;
};

type LeanUomRule = {
  _id: Types.ObjectId;
  decimals?: number;
};

function isRelated(row: LeanItemUom): boolean {
  return !row.isBase && row.conversionFactor != null && row.conversionFactor !== "";
}

/**
 * Rounding for a RAB line landing on `target`. A base target uses the decimals
 * set on any row in its base group (e.g. 0 on "sheet" = whole sheets, converted
 * to base units); an unrelated target uses its own. Otherwise the target UOM's
 * decimals decide. The direction is the deciding row's, else the target's.
 */
export function resolveRabRounding(
  target: LeanItemUom,
  itemRows: LeanItemUom[],
  targetDecimals: number | undefined,
): RabRounding {
  const group = target.isBase
    ? itemRows.filter((r) => r.isBase || isRelated(r))
    : [target];
  const ruleRow = group.find((r) => r.decimals != null);
  if (ruleRow?.decimals != null) {
    const factor = isRelated(ruleRow) ? ruleRow.conversionFactor! : "1";
    const step = parsePositiveDecimal(stepFromDecimals(ruleRow.decimals), "step").mul(
      parsePositiveDecimal(factor),
    );
    return {
      step: formatDecimal(step),
      source: "item",
      mode: ruleRow.rounding ?? "up",
    };
  }
  return {
    step: stepFromDecimals(targetDecimals ?? UOM_DEFAULT_DECIMALS),
    source: "unit",
    mode: target.rounding ?? "up",
  };
}

/**
 * Build the RAB UOM plan for every material×UOM used by `boqs`: convertible
 * UOMs map to the material's base UOM; rounding comes from the item's own
 * decimals, else the target UOM's.
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
    .select({ decimals: 1 })
    .lean()
    .exec()) as LeanUomRule[];
  const uomById = new Map(uoms.map((u) => [String(u._id), u]));

  const byId = new Map(itemUoms.map((r) => [String(r._id), r]));
  const rowsByItem = new Map<string, LeanItemUom[]>();
  for (const row of itemUoms) {
    const key = String(row.itemId);
    rowsByItem.set(key, [...(rowsByItem.get(key) ?? []), row]);
  }

  for (const source of sources) {
    const key = rabLineKey(source.materialItemId, source.itemUomId);
    if (plan.has(key)) continue;
    const row = byId.get(source.itemUomId);
    if (!row) continue;
    const itemRows = rowsByItem.get(source.materialItemId) ?? [];
    const base = itemRows.find((r) => r.isBase);
    const convertible = base !== undefined && (row.isBase || isRelated(row));
    const target = convertible ? base : row;
    plan.set(key, {
      targetItemUomId: String(target._id),
      factor: convertible && !row.isBase ? row.conversionFactor! : "1",
      rounding: resolveRabRounding(
        target,
        itemRows,
        uomById.get(String(target.uomId))?.decimals,
      ),
    });
  }
  return plan;
}
