import Decimal from "decimal.js";
import {
  formatDecimal,
  parseQtyDecimal,
} from "../itemMaster/itemUomConvert";
import {
  collectSourceLines,
  rabLineKey,
  type BoqLike,
} from "../project/projectRab.planner";

export const LABOUR_LINE_KEY = "labour";
export const DEFAULT_LABOUR_DESCRIPTION = "Installation & labour";
export const DEFAULT_ITEM_UOM = "unit";
export const DEFAULT_LABOUR_UOM = "lot";

export type QuotationDiscountType = "percent" | "amount";

export type PlannerLine = {
  key: string;
  kind: "item" | "labour";
  shopDrawingItemId?: string;
  shopDrawingFileId?: string;
  description: string;
  qty: string;
  uom: string;
  costUnitPrice: string;
  unitPrice: string;
  priceOverridden: boolean;
};

export type SeedBoq = BoqLike & {
  shopDrawingItemId: string;
  shopDrawingFileId: string;
  itemName: string;
  fileVersion: number;
};

export type SeedRabLine = {
  key: string;
  totalQty: string;
  unitPrice?: string | null;
  origin?: string | null;
};

export type QuotationTotals = {
  costTotal: string;
  subtotal: string;
  discountAmount: string;
  taxBase: string;
  taxAmount: string;
  grandTotal: string;
  margin: string;
};

export function quotationNumber(projectNumber: string, revision: number): string {
  return `QUO/${projectNumber}/R${revision}`;
}

export function boqLineKey(shopDrawingFileId: string): string {
  return `boq:${shopDrawingFileId}`;
}

function rupiah(d: Decimal): string {
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
}

/** cost × (1 + markup%), rounded to whole rupiah. */
export function sellPriceFromCost(costUnitPrice: string, markupPercent: string): string {
  const cost = parseQtyDecimal(costUnitPrice);
  const factor = new Decimal(1).add(parseQtyDecimal(markupPercent).div(100));
  return rupiah(cost.mul(factor));
}

/** Cost of one unit of a drawing = Σ qtyPerUnit × RAB unit price. */
export function boqUnitCost(
  boq: BoqLike,
  priceByKey: Map<string, string>,
): string {
  let sum = new Decimal(0);
  for (const row of collectSourceLines([{ ...boq, makeQty: "1" }])) {
    const key = rabLineKey(row.materialItemId, row.itemUomId);
    const price = priceByKey.get(key);
    if (price === undefined) {
      throw new Error(`RAB has no price for material line ${key}`);
    }
    sum = sum.add(parseQtyDecimal(row.qtyPerUnit).mul(parseQtyDecimal(price)));
  }
  return formatDecimal(sum);
}

/**
 * Build quotation lines from live BOQs + locked RAB prices. Descriptions, UOM
 * and user-typed prices carry over from `previous` by key.
 */
export function buildSeedLines(input: {
  boqs: SeedBoq[];
  rabLines: SeedRabLine[];
  markupPercent: string;
  previous?: PlannerLine[];
}): PlannerLine[] {
  const priceByKey = new Map<string, string>();
  let labourCost = new Decimal(0);
  let hasLabour = false;
  for (const line of input.rabLines) {
    if (!line.unitPrice) continue;
    if (line.origin === "labour") {
      hasLabour = true;
      labourCost = labourCost.add(
        parseQtyDecimal(line.totalQty).mul(parseQtyDecimal(line.unitPrice)),
      );
      continue;
    }
    priceByKey.set(line.key, line.unitPrice);
  }

  const prevByKey = new Map((input.previous ?? []).map((l) => [l.key, l]));
  const boqsPerItem = new Map<string, number>();
  for (const boq of input.boqs) {
    boqsPerItem.set(
      boq.shopDrawingItemId,
      (boqsPerItem.get(boq.shopDrawingItemId) ?? 0) + 1,
    );
  }

  const sorted = [...input.boqs].sort((a, b) => {
    const byName = a.itemName.localeCompare(b.itemName);
    if (byName !== 0) return byName;
    return a.fileVersion - b.fileVersion;
  });

  const out: PlannerLine[] = [];
  const carry = (line: PlannerLine): PlannerLine => {
    const prev = prevByKey.get(line.key);
    if (!prev) return line;
    return {
      ...line,
      description: prev.description,
      uom: prev.uom,
      ...(prev.priceOverridden
        ? { unitPrice: prev.unitPrice, priceOverridden: true }
        : {}),
    };
  };

  for (const boq of sorted) {
    const costUnitPrice = boqUnitCost(boq, priceByKey);
    const description =
      (boqsPerItem.get(boq.shopDrawingItemId) ?? 0) > 1
        ? `${boq.itemName} (v${boq.fileVersion})`
        : boq.itemName;
    out.push(
      carry({
        key: boqLineKey(boq.shopDrawingFileId),
        kind: "item",
        shopDrawingItemId: boq.shopDrawingItemId,
        shopDrawingFileId: boq.shopDrawingFileId,
        description,
        qty: formatDecimal(parseQtyDecimal(boq.makeQty)),
        uom: DEFAULT_ITEM_UOM,
        costUnitPrice,
        unitPrice: sellPriceFromCost(costUnitPrice, input.markupPercent),
        priceOverridden: false,
      }),
    );
  }

  if (hasLabour) {
    const costUnitPrice = formatDecimal(labourCost);
    out.push(
      carry({
        key: LABOUR_LINE_KEY,
        kind: "labour",
        description: DEFAULT_LABOUR_DESCRIPTION,
        qty: "1",
        uom: DEFAULT_LABOUR_UOM,
        costUnitPrice,
        unitPrice: sellPriceFromCost(costUnitPrice, input.markupPercent),
        priceOverridden: false,
      }),
    );
  }

  return out;
}

/** Recompute non-overridden sell prices after a markup change. */
export function repriceLines(
  lines: PlannerLine[],
  markupPercent: string,
): PlannerLine[] {
  return lines.map((l) =>
    l.priceOverridden
      ? l
      : { ...l, unitPrice: sellPriceFromCost(l.costUnitPrice, markupPercent) },
  );
}

export function lineTotal(line: { qty: string; unitPrice: string }): string {
  return rupiah(parseQtyDecimal(line.qty).mul(parseQtyDecimal(line.unitPrice)));
}

export function computeTotals(input: {
  lines: Array<{ qty: string; unitPrice: string; costUnitPrice: string }>;
  discountType: QuotationDiscountType;
  discountValue: string;
  taxPercent: string;
}): QuotationTotals {
  let subtotal = new Decimal(0);
  let cost = new Decimal(0);
  for (const line of input.lines) {
    subtotal = subtotal.add(lineTotal(line));
    cost = cost.add(
      parseQtyDecimal(line.qty).mul(parseQtyDecimal(line.costUnitPrice)),
    );
  }

  const value = parseQtyDecimal(input.discountValue);
  let discount =
    input.discountType === "percent"
      ? new Decimal(rupiah(subtotal.mul(value).div(100)))
      : new Decimal(rupiah(value));
  if (discount.gt(subtotal)) discount = subtotal;

  const taxBase = subtotal.sub(discount);
  const tax = new Decimal(
    rupiah(taxBase.mul(parseQtyDecimal(input.taxPercent)).div(100)),
  );

  return {
    costTotal: rupiah(cost),
    subtotal: rupiah(subtotal),
    discountAmount: rupiah(discount),
    taxBase: rupiah(taxBase),
    taxAmount: rupiah(tax),
    grandTotal: rupiah(taxBase.add(tax)),
    margin: rupiah(taxBase.sub(cost)),
  };
}

export const UNCATEGORIZED_SECTION = "LAIN-LAIN";
export const LABOUR_SECTION = "JASA";

export type QuotationSection = {
  title: string;
  /** Indexes into the quotation's `lines`, in printed order. */
  lineIndexes: number[];
  subtotal: string;
};

const ROMAN: Array<[number, string]> = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

export function toRoman(n: number): string {
  let rest = n;
  let out = "";
  for (const [value, numeral] of ROMAN) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}

/**
 * Category sections for printing. Empty when no item line has a category
 * (the quotation prints flat as before). Otherwise: categories A→Z, then
 * uncategorized items as LAIN-LAIN, then labour lines as JASA.
 */
export function buildQuotationSections(
  lines: Array<{
    kind: "item" | "labour";
    category: string | null;
    qty: string;
    unitPrice: string;
  }>,
): QuotationSection[] {
  if (!lines.some((l) => l.kind === "item" && l.category)) return [];

  const byTitle = new Map<string, number[]>();
  lines.forEach((line, idx) => {
    const title =
      line.kind === "labour"
        ? LABOUR_SECTION
        : (line.category ?? UNCATEGORIZED_SECTION);
    const list = byTitle.get(title) ?? [];
    list.push(idx);
    byTitle.set(title, list);
  });

  const rank = (title: string) =>
    title === LABOUR_SECTION ? 2 : title === UNCATEGORIZED_SECTION ? 1 : 0;
  return [...byTitle.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([title, lineIndexes]) => ({
      title,
      lineIndexes,
      subtotal: rupiah(
        lineIndexes.reduce(
          (sum, i) => sum.plus(lineTotal(lines[i]!)),
          new Decimal(0),
        ),
      ),
    }));
}
