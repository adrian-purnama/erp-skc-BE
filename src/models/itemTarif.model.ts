import { Schema, type Types } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

export interface ItemTarifInterface {
  itemId: Types.ObjectId;
  /** Calendar date YYYY-MM-DD; row is effective from this date until the next. */
  effectiveDate: string;
  /** Non-negative decimal string. */
  amount: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const itemTarifSchema = new Schema<ItemTarifInterface>(
  {
    itemId: {
      type: Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
    effectiveDate: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true },
);

itemTarifSchema.index({ itemId: 1, effectiveDate: 1 }, { unique: true });
itemTarifSchema.index({ itemId: 1, effectiveDate: -1 });

export const ItemTarifRepo = auditedModel<ItemTarifInterface>(
  "ItemTarif",
  itemTarifSchema,
);
