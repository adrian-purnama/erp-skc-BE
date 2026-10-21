import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export interface ItemUomInterface {
  itemId: Types.ObjectId;
  uomId: Types.ObjectId;
  isBase: boolean;
  /** Related: factor vs base. Null: not related / not convertible. Base always "1". */
  conversionFactor: string | null;
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
