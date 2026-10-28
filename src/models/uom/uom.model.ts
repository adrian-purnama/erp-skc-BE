import { Schema } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

/** How quantities in this UOM are rounded on the project RAB (purchase qty). */
export const UOM_ROUNDING_MODES = ["up", "nearest", "down"] as const;
export type UomRoundingMode = (typeof UOM_ROUNDING_MODES)[number];

export const UOM_MAX_DECIMALS = 8;
export const UOM_DEFAULT_DECIMALS = 4;

export interface UomInterface {
  symbol: string;
  category: string;
  name: string;
  /** Quantity expressions using v1…v3, e.g. ["v1"] or ["v1", "v1 * v2"]. */
  formulas?: string[];
  /** Decimal places kept when rounding RAB totals (0 = whole units). */
  decimals?: number;
  rounding?: UomRoundingMode;
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
    decimals: {
      type: Number,
      required: true,
      default: UOM_DEFAULT_DECIMALS,
      min: 0,
      max: UOM_MAX_DECIMALS,
    },
    rounding: {
      type: String,
      required: true,
      enum: UOM_ROUNDING_MODES,
      default: "up",
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
