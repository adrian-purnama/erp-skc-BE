import { model, Schema } from "mongoose";

export interface RoleInterface {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  includes: string[];
  effectivePermissions: string[];
  isSystem: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const roleSchema = new Schema<RoleInterface>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: false,
      default: "",
    },
    permissions: {
      type: [String],
      required: true,
      default: [],
    },
    includes: {
      type: [String],
      required: true,
      default: [],
    },
    effectivePermissions: {
      type: [String],
      required: true,
      default: [],
    },
    isSystem: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { timestamps: true },
);

export const RoleModel = model<RoleInterface>("Role", roleSchema);
