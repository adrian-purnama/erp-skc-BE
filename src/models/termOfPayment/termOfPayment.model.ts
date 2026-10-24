import { Schema } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

export interface TermOfPaymentInterface {
  termOfPayment: string;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const termOfPaymentSchema = new Schema<TermOfPaymentInterface>(
  {
    termOfPayment: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

termOfPaymentSchema.index(
  { termOfPayment: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);

export const TermOfPaymentRepo = auditedModel<TermOfPaymentInterface>(
  "TermOfPayment",
  termOfPaymentSchema,
);
