import Decimal from "decimal.js";
import { formatDecimal, parseQtyDecimal } from "../../utils/decimal";
import {
  type BoqLike,
  collectSourceLines,
  type RabUomPlan,
  resolveRabTarget,
} from "../project";

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
  /** Kode; lines are ordered by it, then by name. */
  itemCode?: string;
  itemName: string;
  fileVersion: number;
};

export type SeedRabLine = {
  key: string;
  totalQty: string;
  /** Need before rounding; rounding waste is spread over drawings by it. */
  exactQty?: string | null;
  unitPrice?: string | null;
  origin?: string | null;
  /** Labour costed to one shop drawing item; absent = project-wide labour. */
  shopDrawingItemId?: string | null;
};

export type QuotationCharge = {
  key: string;
  label: string;
  /** Added to or deducted from the total; absent = add. */
  sign?: "add" | "deduct";
  /** Printed reason, e.g. "pembayaran tunai". */
  note?: string;
  kind: "percent" | "fixed";
  value: string;
  enabled: boolean;
};

/** A charge with sign and reason filled in. */
export type ResolvedQuotationCharge = QuotationCharge & { sign: "add" | "deduct"; note: string };

/** A charge with its signed rupiah amount (negative when deducted, 0 when disabled). */
export type QuotationChargeTotal = ResolvedQuotationCharge & { amount: string };

export type QuotationTotals = {
  costTotal: string;
  subtotal: string;
  discountAmount: string;
  taxBase: string;
  charges: QuotationChargeTotal[];
  /** Σ enabled charges, deductions negative. */
  chargesTotal: string;
  grandTotal: string;
  margin: string;
};

/** New quotations start with PPN 11% (it can be switched off, renamed or retuned). */
export const DEFAULT_QUOTATION_CHARGES: readonly QuotationCharge[] = [
  { key: "ppn", label: "PPN", sign: "add", note: "", kind: "percent", value: "11", enabled: true },
];

/** The quotation's charges; old revisions only had a PPN percent. */
export function quotationCharges(doc: {
  charges?: QuotationCharge[] | null;
  taxPercent?: string | null;
}): ResolvedQuotationCharge[] {
  if (doc.charges) {
    return doc.charges.map((c) => ({ ...c, sign: c.sign ?? "add", note: c.note ?? "" }));
  }
  const tax = doc.taxPercent ?? "11";
  return [
    {
      key: "ppn",
      label: "PPN",
      sign: "add",
      note: "",
      kind: "percent",
      value: tax,
      enabled: parseQtyDecimal(tax).gt(0),
    },
  ];
}

/**
 * Printed label: "PPN 11%" for a percent charge, the label alone when fixed,
 * then the reason in brackets: "Potongan 5% (pembayaran tunai)".
 */
export function chargeLabel(
  c: Pick<QuotationCharge, "label" | "kind" | "value" | "note">,
): string {
  const base = c.kind === "percent" ? `${c.label} ${c.value}%` : c.label;
  const note = c.note?.trim();
  return note ? `${base} (${note})` : base;
}

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

/**
 * Cost of one unit of a drawing = Σ qtyPerUnit (in RAB UOM) × RAB cost per
 * needed unit. `priceByKey` already carries the rounding-waste share.
 */
export function boqUnitCost(
  boq: BoqLike,
  priceByKey: Map<string, string>,
  plan?: RabUomPlan,
): string {
  let sum = new Decimal(0);
  for (const row of collectSourceLines([{ ...boq, makeQty: "1" }])) {
    const target = resolveRabTarget(row.materialItemId, row.itemUomId, plan);
    const price = priceByKey.get(target.key);
    if (price === undefined) {
      throw new Error(`RAB has no price for material line ${target.key}`);
    }
    sum = sum.add(
      parseQtyDecimal(row.qtyPerUnit)
        .mul(target.factor)
        .mul(parseQtyDecimal(price)),
    );
  }
  return formatDecimal(sum);
}

/** unitPrice × totalQty / exactQty: purchase cost spread over the real need. */
function costPerNeededUnit(line: SeedRabLine, unitPrice: string): string {
  if (!line.exactQty) return unitPrice;
  const exact = parseQtyDecimal(line.exactQty);
  if (exact.isZero()) return unitPrice;
  return formatDecimal(
    parseQtyDecimal(unitPrice)
      .mul(parseQtyDecimal(line.totalQty))
      .div(exact),
  );
}

/**
 * Build quotation lines from live BOQs + locked RAB prices. Descriptions, UOM
 * and user-typed prices carry over from `previous` by key. Labour on a shop
 * drawing item is spread over that item's units; the rest (project-wide, or an
 * item with no quoted drawing) becomes one labour line.
 */
export function buildSeedLines(input: {
  boqs: SeedBoq[];
  rabLines: SeedRabLine[];
  markupPercent: string;
  previous?: PlannerLine[];
  plan?: RabUomPlan;
  /** RAB charges spread over every cost: (subtotal + charges) / subtotal. */
  chargeFactor?: string;
}): PlannerLine[] {
  // A ratio, not a qty: (subtotal + charges) / subtotal often has far more
  // than the 8 decimals parseQtyDecimal allows.
  const factor = new Decimal(input.chargeFactor ?? "1");
  const priceByKey = new Map<string, string>();
  const labourByItem = new Map<string, Decimal>();
  for (const line of input.rabLines) {
    if (!line.unitPrice) continue;
    if (line.origin === "labour") {
      const itemId = line.shopDrawingItemId ?? "";
      labourByItem.set(
        itemId,
        (labourByItem.get(itemId) ?? new Decimal(0)).add(
          parseQtyDecimal(line.totalQty)
            .mul(parseQtyDecimal(line.unitPrice))
            .mul(factor),
        ),
      );
      continue;
    }
    priceByKey.set(
      line.key,
      formatDecimal(
        parseQtyDecimal(costPerNeededUnit(line, line.unitPrice)).mul(factor),
      ),
    );
  }

  const prevByKey = new Map((input.previous ?? []).map((l) => [l.key, l]));
  const boqsPerItem = new Map<string, number>();
  const unitsPerItem = new Map<string, Decimal>();
  for (const boq of input.boqs) {
    boqsPerItem.set(
      boq.shopDrawingItemId,
      (boqsPerItem.get(boq.shopDrawingItemId) ?? 0) + 1,
    );
    unitsPerItem.set(
      boq.shopDrawingItemId,
      (unitsPerItem.get(boq.shopDrawingItemId) ?? new Decimal(0)).add(
        parseQtyDecimal(boq.makeQty),
      ),
    );
  }
  let labourCost = new Decimal(0);
  let hasLabour = false;
  for (const [itemId, cost] of labourByItem) {
    const units = unitsPerItem.get(itemId);
    if (itemId && units && !units.isZero()) continue;
    hasLabour = true;
    labourCost = labourCost.add(cost);
  }
  const labourPerUnit = (itemId: string): Decimal => {
    const cost = labourByItem.get(itemId);
    const units = unitsPerItem.get(itemId);
    if (!cost || !units || units.isZero()) return new Decimal(0);
    return cost.div(units);
  };

  const sorted = [...input.boqs].sort((a, b) => {
    const byCode = (a.itemCode ?? "").localeCompare(b.itemCode ?? "", undefined, {
      numeric: true,
    });
    if (byCode !== 0) return byCode;
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
    const costUnitPrice = formatDecimal(
      parseQtyDecimal(boqUnitCost(boq, priceByKey, input.plan)).add(
        labourPerUnit(boq.shopDrawingItemId),
      ),
    );
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
  charges: QuotationCharge[];
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
  // Every percent line is on the DPP, so lines never compound on each other.
  let chargesTotal = new Decimal(0);
  const charges = input.charges.map((raw): QuotationChargeTotal => {
    const c = { ...raw, sign: raw.sign ?? "add", note: raw.note ?? "" };
    if (!c.enabled) return { ...c, amount: "0" };
    const size = new Decimal(
      c.kind === "percent"
        ? rupiah(taxBase.mul(parseQtyDecimal(c.value)).div(100))
        : rupiah(parseQtyDecimal(c.value)),
    );
    const amount = c.sign === "deduct" ? size.neg() : size;
    chargesTotal = chargesTotal.add(amount);
    return { ...c, amount: rupiah(amount) };
  });
  // Deductions can at most bring the total to zero.
  const grand = Decimal.max(taxBase.add(chargesTotal), 0);

  return {
    costTotal: rupiah(cost),
    subtotal: rupiah(subtotal),
    discountAmount: rupiah(discount),
    taxBase: rupiah(taxBase),
    charges,
    chargesTotal: rupiah(grand.sub(taxBase)),
    grandTotal: rupiah(grand),
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
