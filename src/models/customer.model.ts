import { Schema } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

export interface CustomerInterface {
  name: string;
  address: string;
  npwp?: string;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const customerSchema = new Schema<CustomerInterface>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: false,
      trim: true,
      default: "",
    },
    npwp: {
      type: String,
      trim: true,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

customerSchema.index({ name: 1 });

export const CustomerRepo = auditedModel<CustomerInterface>(
  "Customer",
  customerSchema,
);
