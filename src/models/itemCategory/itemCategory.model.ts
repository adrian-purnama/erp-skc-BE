import { Schema } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export interface ItemCategoryInterface {
  name: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const itemCategorySchema = new Schema<ItemCategoryInterface>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
  },
  { timestamps: true },
);

export const ItemCategoryRepo = auditedModel<ItemCategoryInterface>(
  "ItemCategory",
  itemCategorySchema,
);
