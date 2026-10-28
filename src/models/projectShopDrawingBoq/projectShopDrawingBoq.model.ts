import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";

/** Where a finishing sits relative to its base material (sandwich). */
export const SHOP_DRAWING_BOQ_FINISH_PLACEMENTS = ["top", "bottom"] as const;

export type ShopDrawingBoqFinishPlacement =
  (typeof SHOP_DRAWING_BOQ_FINISH_PLACEMENTS)[number];

export const SHOP_DRAWING_BOQ_MOUNTING_TYPES = [
  "mounted",
  "hanging",
  "pylon",
  "blade",
  "freestanding",
  "other",
] as const;

export type ShopDrawingBoqMountingType =
  (typeof SHOP_DRAWING_BOQ_MOUNTING_TYPES)[number];

export type ProjectShopDrawingBoqLineInputs = {
  v1: string;
  v2?: string;
  v3?: string;
};

export type ProjectShopDrawingBoqLine = {
  materialItemId: Types.ObjectId;
  itemUomId: Types.ObjectId;
  /** Snapshotted expression; not re-read from UOM master after save. */
  formula: string;
  inputs: ProjectShopDrawingBoqLineInputs;
  /** How many SD units one formula quantity makes (1 sheet → 50 pcs). Absent = 1. */
  yieldQty?: string;
  /** formula result ÷ yieldQty. */
  qtyPerUnit: string;
  /** Set when the line was added after RAB lock froze this BOQ. */
  addedAt?: Date;
  addedBy?: Types.ObjectId;
  addReason?: string;
};

export type ProjectShopDrawingBoqFinishing = {
  /** Unique within the same placement on this base. 1 = closest to the material. */
  finishingOrder: number;
  placement: ShopDrawingBoqFinishPlacement;
  lines: ProjectShopDrawingBoqLine[];
};

/** One base material with optional finishings above and/or below (sandwich). */
export type ProjectShopDrawingBoqBase = ProjectShopDrawingBoqLine & {
  key: string;
  spec?: string;
  finishings: ProjectShopDrawingBoqFinishing[];
};

export type ProjectShopDrawingBoqPart = {
  key: string;
  label?: string;
  bases: ProjectShopDrawingBoqBase[];
};

/** Flat joining materials (glue, bolts, …) — same shape as lighting/mounting lines. */
export type ProjectShopDrawingBoqAssembly = {
  lines: ProjectShopDrawingBoqLine[];
};

export type ProjectShopDrawingBoqMain = {
  parts: ProjectShopDrawingBoqPart[];
  assembly: ProjectShopDrawingBoqAssembly;
};

export type ProjectShopDrawingBoqLighting = {
  lines: ProjectShopDrawingBoqLine[];
};

export type ProjectShopDrawingBoqMounting = {
  type: ShopDrawingBoqMountingType;
  lines: ProjectShopDrawingBoqLine[];
};

export type ProjectShopDrawingBoqOther = {
  lines: ProjectShopDrawingBoqLine[];
};

export interface ProjectShopDrawingBoqInterface {
  projectId: Types.ObjectId;
  shopDrawingItemId: Types.ObjectId;
  shopDrawingFileId: Types.ObjectId;
  makeQty: string;
  /** YYYY-MM-DD when client mockup was approved; null/absent if not needed or not yet. */
  mockupApproveDate?: string | null;
  main: ProjectShopDrawingBoqMain;
  lighting: ProjectShopDrawingBoqLighting;
  mounting: ProjectShopDrawingBoqMounting;
  other: ProjectShopDrawingBoqOther;
  /** Set when the project's RAB is locked — existing content becomes append-only. */
  contentFrozenAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const projectShopDrawingBoqLineInputsSchema = new Schema(
  {
    v1: { type: String, required: true, trim: true },
    v2: { type: String, required: false, trim: true },
    v3: { type: String, required: false, trim: true },
  },
  { _id: false },
);

const projectShopDrawingBoqLineSchema = new Schema(
  {
    materialItemId: {
      type: Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
    itemUomId: {
      type: Schema.Types.ObjectId,
      ref: "ItemUom",
      required: true,
    },
    formula: {
      type: String,
      required: true,
      trim: true,
      default: "v1",
    },
    inputs: {
      type: projectShopDrawingBoqLineInputsSchema,
      required: true,
    },
    yieldQty: { type: String, required: false, trim: true },
    qtyPerUnit: {
      type: String,
      required: true,
      trim: true,
    },
    addedAt: { type: Date, required: false },
    addedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    addReason: { type: String, required: false, trim: true },
  },
  { _id: false },
);

const projectShopDrawingBoqFinishingSchema = new Schema(
  {
    finishingOrder: { type: Number, required: true, min: 1 },
    placement: {
      type: String,
      required: true,
      enum: SHOP_DRAWING_BOQ_FINISH_PLACEMENTS,
    },
    lines: {
      type: [projectShopDrawingBoqLineSchema],
      required: true,
      default: [],
    },
  },
  { _id: false },
);

const projectShopDrawingBoqBaseSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    materialItemId: {
      type: Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
    itemUomId: {
      type: Schema.Types.ObjectId,
      ref: "ItemUom",
      required: true,
    },
    formula: {
      type: String,
      required: true,
      trim: true,
      default: "v1",
    },
    inputs: {
      type: projectShopDrawingBoqLineInputsSchema,
      required: true,
    },
    yieldQty: { type: String, required: false, trim: true },
    qtyPerUnit: {
      type: String,
      required: true,
      trim: true,
    },
    spec: { type: String, required: false, trim: true },
    finishings: {
      type: [projectShopDrawingBoqFinishingSchema],
      required: true,
      default: [],
    },
    addedAt: { type: Date, required: false },
    addedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    addReason: { type: String, required: false, trim: true },
  },
  { _id: false },
);

const projectShopDrawingBoqPartSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: false, trim: true },
    bases: {
      type: [projectShopDrawingBoqBaseSchema],
      required: true,
      default: [],
    },
  },
  { _id: false },
);

const projectShopDrawingBoqAssemblySchema = new Schema(
  {
    lines: {
      type: [projectShopDrawingBoqLineSchema],
      required: true,
      default: [],
    },
  },
  { _id: false },
);

const projectShopDrawingBoqMainSchema = new Schema(
  {
    parts: {
      type: [projectShopDrawingBoqPartSchema],
      required: true,
      default: [],
    },
    assembly: {
      type: projectShopDrawingBoqAssemblySchema,
      required: true,
      default: () => ({ lines: [] }),
    },
  },
  { _id: false },
);

const projectShopDrawingBoqLightingSchema = new Schema(
  {
    lines: {
      type: [projectShopDrawingBoqLineSchema],
      required: true,
      default: [],
    },
  },
  { _id: false },
);

const projectShopDrawingBoqMountingSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: SHOP_DRAWING_BOQ_MOUNTING_TYPES,
      default: "mounted",
    },
    lines: {
      type: [projectShopDrawingBoqLineSchema],
      required: true,
      default: [],
    },
  },
  { _id: false },
);

const projectShopDrawingBoqOtherSchema = new Schema(
  {
    lines: {
      type: [projectShopDrawingBoqLineSchema],
      required: true,
      default: [],
    },
  },
  { _id: false },
);

const projectShopDrawingBoqSchema = new Schema<ProjectShopDrawingBoqInterface>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    shopDrawingItemId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingItem",
      required: true,
      index: true,
    },
    shopDrawingFileId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingDocument",
      required: true,
    },
    makeQty: {
      type: String,
      required: true,
      trim: true,
    },
    mockupApproveDate: {
      type: String,
      required: false,
      default: null,
      trim: true,
    },
    main: {
      type: projectShopDrawingBoqMainSchema,
      required: true,
      default: () => ({ parts: [], assembly: { lines: [] } }),
    },
    lighting: {
      type: projectShopDrawingBoqLightingSchema,
      required: true,
      default: () => ({ lines: [] }),
    },
    mounting: {
      type: projectShopDrawingBoqMountingSchema,
      required: true,
      default: () => ({ type: "mounted", lines: [] }),
    },
    other: {
      type: projectShopDrawingBoqOtherSchema,
      required: true,
      default: () => ({ lines: [] }),
    },
    contentFrozenAt: { type: Date, required: false },
  },
  { timestamps: true },
);

projectShopDrawingBoqSchema.index({ shopDrawingFileId: 1 }, { unique: true });
projectShopDrawingBoqSchema.index({ projectId: 1, shopDrawingItemId: 1 });

export const ProjectShopDrawingBoqRepo =
  auditedModel<ProjectShopDrawingBoqInterface>(
    "ProjectShopDrawingBoq",
    projectShopDrawingBoqSchema,
  );
