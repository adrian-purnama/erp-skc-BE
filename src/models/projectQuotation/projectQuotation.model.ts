import { Schema, type Types } from "mongoose";
import { auditedModel } from "../../core/audit/auditedModel";
import {
  PROJECT_GENDERS,
  type ProjectGender,
} from "../project/project.model";

export const PROJECT_QUOTATION_STATUSES = [
  "draft",
  "issued",
  "superseded",
] as const;
export type ProjectQuotationStatus =
  (typeof PROJECT_QUOTATION_STATUSES)[number];

export const PROJECT_QUOTATION_LINE_KINDS = ["item", "labour"] as const;
export type ProjectQuotationLineKind =
  (typeof PROJECT_QUOTATION_LINE_KINDS)[number];

export const PROJECT_QUOTATION_DISCOUNT_TYPES = ["percent", "amount"] as const;
export type ProjectQuotationDiscountType =
  (typeof PROJECT_QUOTATION_DISCOUNT_TYPES)[number];

export type ProjectQuotationLine = {
  /** `boq:<shopDrawingFileId>` for drawing items, `labour` for the labour lump sum. */
  key: string;
  kind: ProjectQuotationLineKind;
  shopDrawingItemId?: Types.ObjectId;
  shopDrawingFileId?: Types.ObjectId;
  description: string;
  qty: string;
  uom: string;
  /** RAB cost per unit at seed time (internal; not printed). */
  costUnitPrice: string;
  /** Sell price per unit (integer rupiah). */
  unitPrice: string;
  /** True when unitPrice was typed by a user instead of cost × markup. */
  priceOverridden: boolean;
};

/** Letterhead copied from AppConfig. */
export type ProjectQuotationCompanySnapshot = {
  name: string;
  npwp: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Copy of the company profile logo in the `quotation` bucket (set on issue). */
  logoFileId?: Types.ObjectId | null;
  /** AppConfig.companyProfile id the copy was made from (dedupes copies). */
  logoSourceId?: Types.ObjectId | null;
};

export type ProjectQuotationCustomerSnapshot = {
  customerId: Types.ObjectId;
  name: string;
  address: string;
  npwp: string;
};

export type ProjectQuotationContactSnapshot = {
  name: string;
  gender: ProjectGender;
  contact: Record<string, string>;
};

export interface ProjectQuotationInterface {
  projectId: Types.ObjectId;
  /** 1, 2, … per project. */
  revision: number;
  quotationNumber: string;
  status: ProjectQuotationStatus;
  /** Committed RAB change revision the lines were seeded from (0 = lock baseline). */
  rabRevision: number;
  subject: string;
  markupPercent: string;
  discountType: ProjectQuotationDiscountType;
  discountValue: string;
  taxPercent: string;
  /** YYYY-MM-DD or null. */
  validUntil?: string | null;
  notes: string;
  termOfPaymentId?: Types.ObjectId | null;
  termOfPaymentText: string;
  company: ProjectQuotationCompanySnapshot;
  customer: ProjectQuotationCustomerSnapshot;
  contact: ProjectQuotationContactSnapshot;
  lines: ProjectQuotationLine[];
  createdBy: Types.ObjectId;
  issuedAt?: Date;
  issuedBy?: Types.ObjectId;
  /** Unguessable id in the client link; the link itself is the credential. */
  verifyToken?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    kind: { type: String, required: true, enum: PROJECT_QUOTATION_LINE_KINDS },
    shopDrawingItemId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingItem",
      required: false,
    },
    shopDrawingFileId: {
      type: Schema.Types.ObjectId,
      ref: "ProjectShopDrawingDocument",
      required: false,
    },
    description: { type: String, required: true, trim: true },
    qty: { type: String, required: true, trim: true },
    uom: { type: String, required: true, trim: true },
    costUnitPrice: { type: String, required: true, trim: true },
    unitPrice: { type: String, required: true, trim: true },
    priceOverridden: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const companySchema = new Schema(
  {
    name: { type: String, default: "", trim: true },
    npwp: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true },
    website: { type: String, default: "", trim: true },
    logoFileId: { type: Schema.Types.ObjectId, required: false, default: null },
    logoSourceId: { type: Schema.Types.ObjectId, required: false, default: null },
  },
  { _id: false },
);

const customerSchema = new Schema(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    address: { type: String, default: "", trim: true },
    npwp: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const contactSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    gender: { type: String, enum: PROJECT_GENDERS, required: true },
    contact: { type: Map, of: String, default: {} },
  },
  { _id: false },
);

const projectQuotationSchema = new Schema<ProjectQuotationInterface>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    revision: { type: Number, required: true, min: 1 },
    quotationNumber: { type: String, required: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: PROJECT_QUOTATION_STATUSES,
      default: "draft",
      index: true,
    },
    rabRevision: { type: Number, required: true, min: 0 },
    subject: { type: String, default: "", trim: true },
    markupPercent: { type: String, required: true, default: "0" },
    discountType: {
      type: String,
      required: true,
      enum: PROJECT_QUOTATION_DISCOUNT_TYPES,
      default: "percent",
    },
    discountValue: { type: String, required: true, default: "0" },
    taxPercent: { type: String, required: true, default: "11" },
    validUntil: { type: String, required: false, default: null },
    notes: { type: String, default: "", trim: true },
    termOfPaymentId: {
      type: Schema.Types.ObjectId,
      ref: "TermOfPayment",
      required: false,
      default: null,
    },
    termOfPaymentText: { type: String, default: "", trim: true },
    company: { type: companySchema, required: true },
    customer: { type: customerSchema, required: true },
    contact: { type: contactSchema, required: true },
    lines: { type: [lineSchema], required: true, default: [] },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    issuedAt: { type: Date, required: false },
    verifyToken: { type: String, required: false },
    issuedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true },
);

projectQuotationSchema.index({ projectId: 1, revision: 1 }, { unique: true });
projectQuotationSchema.index(
  { verifyToken: 1 },
  { unique: true, partialFilterExpression: { verifyToken: { $type: "string" } } },
);

/** At most one open draft per project. */
projectQuotationSchema.index(
  { projectId: 1 },
  { unique: true, partialFilterExpression: { status: "draft" } },
);

export const ProjectQuotationRepo = auditedModel<ProjectQuotationInterface>(
  "ProjectQuotation",
  projectQuotationSchema,
);
