/** Charges on top of goods (RAB budgets, PO estimates, realization actuals). */

export type RealizationChargeKindDto = "percent" | "fixed";

export type PurchaseChargeCategoryDto = "tax" | "delivery" | "other";

/** Integer rupiah per spending category; null = not estimated / nothing. */
export type PurchaseChargeAmountsDto = Record<PurchaseChargeCategoryDto, string | null>;

export type RealizationChargeInDto = {
  category: PurchaseChargeCategoryDto;
  label: string;
  kind: RealizationChargeKindDto;
  /** Percent of the lines subtotal; required for `percent`. */
  rate: string | null;
  /** Integer rupiah; required for `fixed`, recomputed for `percent`. */
  amount: string;
};

export type RealizationChargeOutDto = RealizationChargeInDto & { id: string };
