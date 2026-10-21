import { Schema } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export interface UomInterface {
  symbol: string;
  category: string;
  name: string;
  /** Quantity expressions using v1…v3, e.g. ["v1"] or ["v1", "v1 * v2"]. */
  formulas?: string[];
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const uomSchema = new Schema<UomInterface>(
  {
    symbol: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    formulas: {
      type: [String],
      required: true,
      default: () => ["v1"],
      validate: {
        validator(value: string[]) {
          return Array.isArray(value) && value.length > 0;
        },
        message: "At least one formula is required",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

uomSchema.index(
  { symbol: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);
uomSchema.index({ category: 1 });

export const UomRepo = auditedModel<UomInterface>("Uom", uomSchema);
