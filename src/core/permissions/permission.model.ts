import { model, Schema } from "mongoose";

export type PermissionStatus = "active" | "deprecated" | "unused";

export interface PermissionRoute {
  method: string;
  path: string;
}

export interface PermissionInterface {
  key: string;
  label: string;
  category: string;
  routes: PermissionRoute[];
  status: PermissionStatus;
  manual: boolean;
  missCount: number;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  deprecatedAt?: Date;
}

const permissionRouteSchema = new Schema<PermissionRoute>(
  {
    method: { type: String, required: true },
    path: { type: String, required: true },
  },
  { _id: false },
);

const permissionSchema = new Schema<PermissionInterface>({
  key: {
    type: String,
    required: true,
    unique: true,
  },
  label: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    required: true,
  },
  routes: {
    type: [permissionRouteSchema],
    required: true,
    default: [],
  },
  status: {
    type: String,
    required: true,
    enum: ["active", "deprecated", "unused"],
  },
  manual: {
    type: Boolean,
    required: true,
    default: false,
  },
  missCount: {
    type: Number,
    required: true,
    default: 0,
  },
  firstSeenAt: {
    type: Date,
    required: false,
  },
  lastSeenAt: {
    type: Date,
    required: false,
  },
  deprecatedAt: {
    type: Date,
    required: false,
  },
});

export const PermissionModel = model<PermissionInterface>(
  "Permission",
  permissionSchema,
);
