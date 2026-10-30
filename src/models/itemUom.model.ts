import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";
import { UOM_MAX_DECIMALS } from "./uom.model";

/** How the RAB rounds the need to the decimals step. */
export const ITEM_UOM_ROUNDING_MODES = ["up", "nearest", "down"] as const;
export type ItemUomRoundingMode = (typeof ITEM_UOM_ROUNDING_MODES)[number];

export interface ItemUomInterface {
  itemId: Types.ObjectId;
  uomId: Types.ObjectId;
  isBase: boolean;
  /** Related: factor vs base. Null: not related / not convertible. Base always "1". */
  conversionFactor: string | null;
  /**
   * RAB decimals in this row's unit (0 = whole sheets, bars, …).
   * Null: the target UOM's decimals. At most one per base group.
   */
  decimals: number | null;
  /** Applies when this row sets the RAB decimals (or is the line's target). */
  rounding: ItemUomRoundingMode;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const itemUomSchema = new Schema<ItemUomInterface>(
  {
    itemId: {
      type: Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
    uomId: {
      type: Schema.Types.ObjectId,
      ref: "Uom",
      required: true,
    },
    isBase: {
      type: Boolean,
      required: true,
      default: false,
    },
    conversionFactor: {
      type: String,
      default: null,
    },
    decimals: {
      type: Number,
      default: null,
      min: 0,
      max: UOM_MAX_DECIMALS,
    },
    rounding: {
      type: String,
      required: true,
      enum: ITEM_UOM_ROUNDING_MODES,
      default: "up",
    },
    sortOrder: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

itemUomSchema.index({ itemId: 1, uomId: 1 }, { unique: true });
itemUomSchema.index(
  { itemId: 1 },
  { unique: true, partialFilterExpression: { isBase: true } },
);
itemUomSchema.index({ itemId: 1, sortOrder: 1 });

export const ItemUomRepo = auditedModel<ItemUomInterface>(
  "ItemUom",
  itemUomSchema,
);
