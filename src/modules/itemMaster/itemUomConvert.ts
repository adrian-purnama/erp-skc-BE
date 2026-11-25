import {
  formatDecimal,
  parsePositiveDecimal,
  parseQtyDecimal,
} from "../../utils/decimal";

/**
 * Convert qty between two factors relative to the same base.
 * factor = how many base units equal 1 of this UOM.
 * qty_to = qty_from * factor_from / factor_to
 */
export function convertByFactors(
  qty: string,
  factorFrom: string,
  factorTo: string,
): string {
  const q = parseQtyDecimal(qty);
  const from = parsePositiveDecimal(factorFrom, "factorFrom");
  const to = parsePositiveDecimal(factorTo, "factorTo");
  return formatDecimal(q.mul(from).div(to));
}

export type ItemUomFactorRow = {
  uomId: string;
  conversionFactor: string | null;
};

/**
 * Item-scoped conversion using registered UOM rows.
 * - same UOM → qty
 * - both related (non-null factors) → qty * from / to
 * - either null → "UOM not convertible for this item"
 * - either missing → "UOM not registered on item"
 */
export function convertItemQty(
  qty: string,
  fromUomId: string,
  toUomId: string,
  rows: ItemUomFactorRow[],
): string {
  if (fromUomId === toUomId) {
    const row = rows.find((r) => r.uomId === fromUomId);
    if (!row) throw new Error("UOM not registered on item");
    return formatDecimal(parseQtyDecimal(qty));
  }

  const fromRow = rows.find((r) => r.uomId === fromUomId);
  const toRow = rows.find((r) => r.uomId === toUomId);
  if (!fromRow || !toRow) {
    throw new Error("UOM not registered on item");
  }
  if (fromRow.conversionFactor == null || toRow.conversionFactor == null) {
    throw new Error("UOM not convertible for this item");
  }
  return convertByFactors(qty, fromRow.conversionFactor, toRow.conversionFactor);
}

export type RescaleRow = {
  uomId: string;
  isBase: boolean;
  /** Factor relative to the previous base (null = not related). */
  conversionFactor: string | null;
};

/** Rescale related factors when base moves to a different UOM. */
export function rescaleFactorsForNewBase(
  rows: RescaleRow[],
  previousBaseUomId: string | null,
): RescaleRow[] {
  const newBase = rows.find((r) => r.isBase);
  if (!newBase) throw new Error("Exactly one base UOM is required");

  if (previousBaseUomId == null || previousBaseUomId === newBase.uomId) {
    return rows.map((r) =>
      r.isBase ? { ...r, conversionFactor: "1" } : r,
    );
  }

  const newBaseInOldTerms = rows.find((r) => r.uomId === newBase.uomId);
  if (!newBaseInOldTerms) {
    throw new Error("New base UOM is not registered on item");
  }
  if (
    newBaseInOldTerms.conversionFactor == null ||
    newBaseInOldTerms.conversionFactor === ""
  ) {
    throw new Error("Cannot switch base to a not-related UOM");
  }

  const fB = parsePositiveDecimal(
    newBaseInOldTerms.conversionFactor,
    "conversionFactor",
  );

  return rows.map((r) => {
    if (r.isBase) {
      return { ...r, conversionFactor: "1" };
    }
    if (r.conversionFactor == null) {
      return r;
    }
    const fX = parsePositiveDecimal(r.conversionFactor, "conversionFactor");
    return {
      ...r,
      conversionFactor: formatDecimal(fX.div(fB)),
    };
  });
}
