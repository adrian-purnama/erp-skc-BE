import Decimal from "decimal.js";
import {
  formatDecimal,
  parsePositiveDecimal,
  parseQtyDecimal,
} from "../itemMaster/itemUomConvert";

export type RabAggSourceLine = {
  materialItemId: string;
  itemUomId: string;
  qtyPerUnit: string;
  makeQty: string;
};

export type RabAggRow = {
  key: string;
  materialItemId: string;
  itemUomId: string;
  totalQty: string;
};

export type RabStoredPricing = {
  key: string;
  unitPrice?: string;
  tarifId?: string;
};

export type RabMergedLine = RabAggRow & {
  unitPrice?: string;
  tarifId?: string;
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

/** Sum totalQty (= qtyPerUnit × makeQty) by material × UOM. */
export function aggregateBoqLinesToRab(rows: RabAggSourceLine[]): RabAggRow[] {
  const totals = new Map<string, Decimal>();
  const meta = new Map<
    string,
    { materialItemId: string; itemUomId: string }
  >();

  for (const row of rows) {
    const key = rabLineKey(row.materialItemId, row.itemUomId);
    const qty = parsePositiveDecimal(row.qtyPerUnit, "qtyPerUnit");
    const make = parsePositiveDecimal(row.makeQty, "makeQty");
    const add = qty.mul(make);
    const prev = totals.get(key) ?? new Decimal(0);
    totals.set(key, prev.add(add));
    meta.set(key, {
      materialItemId: row.materialItemId,
      itemUomId: row.itemUomId,
    });
  }

  const out: RabAggRow[] = [];
  for (const [key, total] of totals) {
    const m = meta.get(key)!;
    out.push({
      key,
      materialItemId: m.materialItemId,
      itemUomId: m.itemUomId,
      totalQty: formatDecimal(total),
    });
  }
  return out;
}

/** Keep unitPrice/tarifId when the same material×UOM key still exists. */
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
