import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export interface ItemInterface {
  itemId: string;
  sequence: number;
  name: string;
  description: string;
  folderId: Types.ObjectId | null;
  /** Synced with the ItemUom row where isBase = true. */
  baseUomId: Types.ObjectId | null;
  vendorIds: Types.ObjectId[];
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const itemSchema = new Schema<ItemInterface>(
  {
    itemId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    sequence: {
      type: Number,
      required: true,
      min: 1,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      default: "",
    },
    folderId: {
      type: Schema.Types.ObjectId,
      ref: "Folder",
      default: null,
    },
    baseUomId: {
      type: Schema.Types.ObjectId,
      ref: "Uom",
      default: null,
    },
    vendorIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Vendor" }],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

itemSchema.index({ folderId: 1 });

export const ItemRepo = auditedModel<ItemInterface>("Item", itemSchema);
