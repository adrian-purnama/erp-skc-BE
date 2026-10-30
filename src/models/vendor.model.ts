import { Schema } from "mongoose";
import { auditedModel } from "../core/audit/auditedModel";

export interface VendorInterface {
  name: string;
  address: string;
  npwp?: string;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const vendorSchema = new Schema<VendorInterface>(
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

vendorSchema.index({ name: 1 });

export const VendorRepo = auditedModel<VendorInterface>(
  "Vendor",
  vendorSchema,
);
