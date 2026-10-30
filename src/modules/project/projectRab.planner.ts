import Decimal from "decimal.js";
import {
  formatDecimal,
  parsePositiveDecimal,
  parseQtyDecimal,
} from "../itemMaster/itemUomConvert";
import type { ItemUomRoundingMode } from "../../models/itemUom.model";
import type { ProjectRabLineRounding } from "../../models/projectRab.model";
import type { PurchaseCharge } from "../../models/purchaseCharge.model";
import { priceStoredCharges } from "../purchasing/purchaseRealization.planner";

export type RabAggSourceLine = {
  materialItemId: string;
  itemUomId: string;
  qtyPerUnit: string;
  makeQty: string;
};

export type RabRounding = ProjectRabLineRounding;

/**
 * Where one BOQ material×UOM lands on the RAB: the material's base UOM when
 * convertible (factor = base units per 1 source unit), else itself (factor 1).
 * The rounding step is in the target UOM.
 */
export type RabUomRule = {
  targetItemUomId: string;
  factor: string;
  rounding?: RabRounding;
};

/** Keyed by rabLineKey(materialItemId, source itemUomId). */
export type RabUomPlan = Map<string, RabUomRule>;

export type RabAggRow = {
  key: string;
  materialItemId: string;
  itemUomId: string;
  /** Purchase qty: exactQty rounded by the rule (= exactQty without one). */
  totalQty: string;
  /** Σ qtyPerUnit × makeQty in the target UOM, before rounding. */
  exactQty: string;
  rounding?: RabRounding;
};

export type RabStoredPricing = {
  key: string;
  unitPrice?: string;
  tarifId?: string;
  priceByTotal?: boolean;
};

export type RabMergedLine = RabAggRow & {
  unitPrice?: string;
  tarifId?: string;
  priceByTotal?: boolean;
};

export function rabLineKey(materialItemId: string, itemUomId: string): string {
  return `${materialItemId}:${itemUomId}`;
}

type BoqLineLike = {
  materialItemId?: unknown;
  itemUomId?: unknown;
  qtyPerUnit?: string;
};

export type BoqLike = {
  makeQty: string;
  main?: {
    parts?: Array<{
      bases?: Array<
        BoqLineLike & { finishings?: Array<{ lines?: BoqLineLike[] }> }
      >;
    }>;
    assembly?: { lines?: BoqLineLike[] };
  };
  lighting?: { lines?: BoqLineLike[] };
  mounting?: { lines?: BoqLineLike[] };
  other?: { lines?: BoqLineLike[] };
};

/** Flatten BOQ lines (bases, finishings, sections) into qty × makeQty rows. */
export function collectSourceLines(boqs: BoqLike[]): RabAggSourceLine[] {
  const out: RabAggSourceLine[] = [];
  const pushLine = (line: BoqLineLike | undefined, makeQty: string) => {
    if (!line?.materialItemId || !line?.itemUomId || !line.qtyPerUnit) return;
    out.push({
      materialItemId: String(line.materialItemId),
      itemUomId: String(line.itemUomId),
      qtyPerUnit: line.qtyPerUnit,
      makeQty,
    });
  };

  for (const boq of boqs) {
    const makeQty = boq.makeQty;
    for (const part of boq.main?.parts ?? []) {
      for (const base of part.bases ?? []) {
        pushLine(base, makeQty);
        for (const finishing of base.finishings ?? []) {
          for (const line of finishing.lines ?? []) {
            pushLine(line, makeQty);
          }
        }
      }
    }
    for (const line of boq.main?.assembly?.lines ?? []) pushLine(line, makeQty);
    for (const line of boq.lighting?.lines ?? []) pushLine(line, makeQty);
    for (const line of boq.mounting?.lines ?? []) pushLine(line, makeQty);
    for (const line of boq.other?.lines ?? []) pushLine(line, makeQty);
  }
  return out;
}

export function isLabourLine(line: { origin?: string | null }): boolean {
  return line.origin === "labour";
}

export function assertAllLinesPriced(
  lines: Array<{ unitPrice?: string | null }>,
  context?: string,
): void {
  const missing = lines.filter(
    (line) => !line.unitPrice || String(line.unitPrice).trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `All RAB lines must have a unit price${context ? ` ${context}` : ""} (${missing.length} missing)`,
    );
  }
}

// Absorbs 8-dp noise from yield division (2/3 × 3 = 2.00000001) before rounding.
const ROUNDING_NOISE_DP = 6;

/** Step for the UOM-decimals fallback: 0 → "1", 2 → "0.01". */
export function stepFromDecimals(decimals: number): string {
  return formatDecimal(new Decimal(10).pow(-decimals));
}

const DECIMAL_MODE: Record<ItemUomRoundingMode, Decimal.Rounding> = {
  up: Decimal.ROUND_UP,
  nearest: Decimal.ROUND_HALF_UP,
  down: Decimal.ROUND_DOWN,
};

/** Round a purchase qty to a multiple of the rule's step, in the rule's direction. */
export function roundRabQty(qty: Decimal, rounding: RabRounding): Decimal {
  const step = parsePositiveDecimal(rounding.step, "rounding.step");
  return qty
    .div(step)
    .toDecimalPlaces(ROUNDING_NOISE_DP, Decimal.ROUND_HALF_UP)
    .toDecimalPlaces(0, DECIMAL_MODE[rounding.mode])
    .mul(step);
}

/** RAB line key + factor for one BOQ source line (identity when not in plan). */
export function resolveRabTarget(
  materialItemId: string,
  itemUomId: string,
  plan?: RabUomPlan,
): { key: string; itemUomId: string; factor: Decimal; rule?: RabUomRule } {
  const rule = plan?.get(rabLineKey(materialItemId, itemUomId));
  if (!rule) {
    return {
      key: rabLineKey(materialItemId, itemUomId),
      itemUomId,
      factor: new Decimal(1),
    };
  }
  return {
    key: rabLineKey(materialItemId, rule.targetItemUomId),
    itemUomId: rule.targetItemUomId,
    factor: parsePositiveDecimal(rule.factor, "conversionFactor"),
    rule,
  };
}

/**
 * Σ qtyPerUnit × makeQty per material, converted to the plan's target UOM,
 * then rounded once per project line (leftovers shared across drawings).
 */
export function aggregateBoqLinesToRab(
  rows: RabAggSourceLine[],
  plan?: RabUomPlan,
): RabAggRow[] {
  const totals = new Map<string, Decimal>();
  const meta = new Map<
    string,
    { materialItemId: string; itemUomId: string; rounding?: RabRounding }
  >();

  for (const row of rows) {
    const target = resolveRabTarget(row.materialItemId, row.itemUomId, plan);
    const qty = parsePositiveDecimal(row.qtyPerUnit, "qtyPerUnit");
    const make = parsePositiveDecimal(row.makeQty, "makeQty");
    const add = qty.mul(make).mul(target.factor);
    const prev = totals.get(target.key) ?? new Decimal(0);
    totals.set(target.key, prev.add(add));
    meta.set(target.key, {
      materialItemId: row.materialItemId,
      itemUomId: target.itemUomId,
      ...(target.rule?.rounding ? { rounding: target.rule.rounding } : {}),
    });
  }

  const out: RabAggRow[] = [];
  for (const [key, total] of totals) {
    const m = meta.get(key)!;
    const row: RabAggRow = {
      key,
      materialItemId: m.materialItemId,
      itemUomId: m.itemUomId,
      totalQty: formatDecimal(m.rounding ? roundRabQty(total, m.rounding) : total),
      exactQty: formatDecimal(total),
    };
    if (m.rounding) row.rounding = m.rounding;
    out.push(row);
  }
  return out;
}

/**
 * totalQty − exactQty (purchase minus need). Negative means rounded down
 * below need. Null when the line has no exact qty (labour / legacy).
 */
export function rabQtyWaste(
  exactQty: string | null | undefined,
  totalQty: string,
): string | null {
  if (exactQty === null || exactQty === undefined || exactQty === "") {
    return null;
  }
  return formatDecimal(parseQtyDecimal(totalQty).sub(parseQtyDecimal(exactQty)));
}

/** Keep unitPrice/tarifId/priceByTotal when the same material×UOM key still exists. */
export function mergeRabPricing(
  scaffold: RabAggRow[],
  previous: RabStoredPricing[],
): RabMergedLine[] {
  const prevByKey = new Map(previous.map((p) => [p.key, p]));
  return scaffold.map((row) => {
    const prev = prevByKey.get(row.key);
    if (!prev) return { ...row };
    const next: RabMergedLine = { ...row };
    if (prev.unitPrice !== undefined && prev.unitPrice !== "") {
      next.unitPrice = prev.unitPrice;
    }
    if (prev.tarifId) next.tarifId = prev.tarifId;
    if (prev.priceByTotal) next.priceByTotal = true;
    return next;
  });
}

/** After lock: only brand-new material×UOM keys become append candidates. */export function computeLineTotal(
  totalQty: string,
  unitPrice: string | null | undefined,
): string | null {
  if (unitPrice === null || unitPrice === undefined || unitPrice === "") {
    return null;
  }
  const qty = parseQtyDecimal(totalQty);
  const price = parseQtyDecimal(unitPrice);
  return formatDecimal(qty.mul(price));
}

/** Unit price that makes `totalQty × price` equal the typed line total. */
export function unitPriceFromLineTotal(
  totalQty: string,
  lineTotal: string,
): string {
  const qty = parseQtyDecimal(totalQty);
  if (qty.isZero()) {
    throw new Error("Line qty is 0: set a unit price instead");
  }
  return formatDecimal(parseQtyDecimal(lineTotal).div(qty));
}

export function sumGrandTotal(lineTotals: Array<string | null>): string | null {
  let sum = new Decimal(0);
  let any = false;
  for (const t of lineTotals) {
    if (t === null || t === undefined || t === "") continue;
    sum = sum.add(parseQtyDecimal(t));
    any = true;
  }
  return any ? formatDecimal(sum) : null;
}

/**
 * RAB totals with its extra charges: percent rows are priced on the line
 * subtotal; grandTotal is null while no line is priced.
 */
export function rabTotalsWithCharges(
  subtotal: string | null,
  charges: PurchaseCharge[],
): {
  subtotal: string | null;
  charges: ReturnType<typeof priceStoredCharges>["charges"];
  chargesTotal: string;
  grandTotal: string | null;
} {
  const priced = priceStoredCharges(subtotal ?? "0", charges);
  return {
    subtotal,
    charges: priced.charges,
    chargesTotal: priced.chargesTotal,
    grandTotal:
      subtotal === null
        ? null
        : formatDecimal(parseQtyDecimal(subtotal).add(priced.chargesTotal)),
  };
}

/**
 * Quotation cost multiplier that spreads the RAB charges over every cost:
 * (subtotal + charges) / subtotal; 1 when there is nothing to spread.
 */
export function rabChargeFactor(
  subtotal: string | null,
  charges: PurchaseCharge[],
): string {
  if (subtotal === null || charges.length === 0) return "1";
  const base = parseQtyDecimal(subtotal);
  if (base.lte(0)) return "1";
  const { chargesTotal } = priceStoredCharges(subtotal, charges);
  return base.add(chargesTotal).div(base).toString();
}

export type RabPurchaseRow = {
  /** `${materialItemId}:${itemUomId}`, as purchasing (SPP / PO) keys lines. */
  key: string;
  materialItemId: string;
  itemUomId: string;
  qty: string;
  /** Average over the priced lines; null when none is priced. */
  unitPrice: string | null;
};

/**
 * Project RAB lines as purchasing sees them: one row per material×UOM.
 * Labour lines are keyed per shop drawing item in the RAB, so the same labour
 * item on several drawings (e.g. an outsource fee) adds up into one row.
 */
export function rabRowsForPurchasing(
  lines: Array<{
    materialItemId: unknown;
    itemUomId: unknown;
    totalQty: string;
    unitPrice?: string | null;
  }>,
): RabPurchaseRow[] {
  const rows = new Map<
    string,
    { materialItemId: string; itemUomId: string; qty: Decimal; pricedQty: Decimal; amount: Decimal }
  >();
  for (const line of lines) {
    const materialItemId = String(line.materialItemId);
    const itemUomId = String(line.itemUomId);
    const key = rabLineKey(materialItemId, itemUomId);
    const row = rows.get(key) ?? {
      materialItemId,
      itemUomId,
      qty: new Decimal(0),
      pricedQty: new Decimal(0),
      amount: new Decimal(0),
    };
    const qty = parseQtyDecimal(line.totalQty);
    row.qty = row.qty.add(qty);
    if (line.unitPrice !== null && line.unitPrice !== undefined && String(line.unitPrice).trim() !== "") {
      row.pricedQty = row.pricedQty.add(qty);
      row.amount = row.amount.add(qty.mul(parseQtyDecimal(line.unitPrice)));
    }
    rows.set(key, row);
  }
  return [...rows].map(([key, r]) => ({
    key,
    materialItemId: r.materialItemId,
    itemUomId: r.itemUomId,
    qty: formatDecimal(r.qty),
    unitPrice: r.pricedQty.gt(0) ? formatDecimal(r.amount.div(r.pricedQty)) : null,
  }));
}
