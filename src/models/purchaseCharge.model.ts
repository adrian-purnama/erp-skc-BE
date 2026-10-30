import { Schema, type Types } from "mongoose";

/**
 * A cost on top of the goods (PPN, ongkir, packing, …), shared by RAB budgets,
 * PO estimates and realization actuals so spending lines up by category.
 */
export const PURCHASE_CHARGE_KINDS = ["percent", "fixed"] as const;
export type PurchaseChargeKind = (typeof PURCHASE_CHARGE_KINDS)[number];

export const PURCHASE_CHARGE_CATEGORIES = ["tax", "delivery", "other"] as const;
export type PurchaseChargeCategory = (typeof PURCHASE_CHARGE_CATEGORIES)[number];

export type PurchaseCharge = {
  _id?: Types.ObjectId;
  /** Spending bucket; absent on charges saved before categories (inferred from the label). */
  category?: PurchaseChargeCategory | null;
  label: string;
  kind: PurchaseChargeKind;
  /** Percent of the goods subtotal; null for fixed charges. */
  rate?: string | null;
  /** Integer rupiah (for percent: as of the last save). */
  amount: string;
};

export const purchaseChargeSchema = new Schema(
  {
    category: { type: String, enum: [...PURCHASE_CHARGE_CATEGORIES, null], default: null },
    label: { type: String, required: true, trim: true },
    kind: { type: String, enum: PURCHASE_CHARGE_KINDS, required: true },
    rate: { type: String, trim: true, default: null },
    amount: { type: String, required: true, trim: true },
  },
  { _id: true },
);
