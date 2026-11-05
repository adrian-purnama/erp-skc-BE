import type { ProjectCustomerContactDto } from "./project.dto";
import type { ProjectRabUserRefOutDto } from "./projectRab.dto";

export type ProjectQuotationStatusDto =
  | "draft"
  | "issued"
  | "superseded"
  | "won";
export type ProjectQuotationDiscountTypeDto = "percent" | "amount";

/**
 * Extra line after the discount (PPN is one): percent of the DPP or fixed
 * rupiah, added to or deducted from the total.
 */
export type ProjectQuotationChargeDto = {
  key: string;
  label: string;
  sign: "add" | "deduct";
  /** Printed reason next to the label ("" = none). */
  note: string;
  kind: "percent" | "fixed";
  value: string;
  /** Off = kept on the form but not added or printed. */
  enabled: boolean;
};

export type ProjectQuotationChargeTotalOutDto = ProjectQuotationChargeDto & {
  /** Signed integer rupiah (negative when deducted); "0" when disabled. */
  amount: string;
};

export type UpdateProjectQuotationInDto = {
  subject?: string;
  markupPercent?: string;
  discountType?: ProjectQuotationDiscountTypeDto;
  discountValue?: string;
  /** Replaces the whole list, in printed order. */
  charges?: ProjectQuotationChargeDto[];
  validUntil?: string | null;
  notes?: string;
  /** Null clears the term of payment. */
  termOfPaymentId?: string | null;
};

export type PatchProjectQuotationLineInDto = {
  description?: string;
  uom?: string;
  /** Null resets the line to cost × (1 + markup). */
  unitPrice?: string | null;
};

export type ProjectQuotationLineOutDto = {
  key: string;
  kind: "item" | "labour";
  shopDrawingItemId: string | null;
  shopDrawingFileId: string | null;
  description: string;
  qty: string;
  uom: string;
  costUnitPrice: string;
  unitPrice: string;
  priceOverridden: boolean;
  lineTotal: string;
  /** Issued: snapshot. Draft: the shop drawing item's current category. */
  category: string | null;
  /** Shop drawing kode, keterangan lines and ukuran (same snapshot rule as category). */
  code: string;
  descriptions: string[];
  dimension: string;
};

/** Category group for printing; empty list = print flat. */
export type ProjectQuotationSectionOutDto = {
  title: string;
  /** "I", "II", … for the SUB TOTAL row. */
  numeral: string;
  /** Indexes into `lines`, in printed order. */
  lineIndexes: number[];
  subtotal: string;
};

export type ProjectQuotationTotalsOutDto = {
  costTotal: string;
  subtotal: string;
  discountAmount: string;
  /** Subtotal after discount (DPP). */
  taxBase: string;
  charges: ProjectQuotationChargeTotalOutDto[];
  /** Σ enabled charges, deductions negative. */
  chargesTotal: string;
  grandTotal: string;
  /** taxBase − costTotal. */
  margin: string;
};

export type ProjectQuotationCompanyOutDto = {
  name: string;
  npwp: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  branchOfficeAddresses: string[];
  /** Issued: logo copy captured. Draft: AppConfig has a company profile logo. */
  hasLogo: boolean;
};

export type ProjectQuotationCustomerOutDto = {
  customerId: string;
  name: string;
  address: string;
  npwp: string;
};

export type ProjectQuotationSummaryOutDto = {
  id: string;
  projectId: string;
  revision: number;
  quotationNumber: string;
  status: ProjectQuotationStatusDto;
  rabRevision: number;
  grandTotal: string;
  createdAt: string | null;
  createdBy: ProjectRabUserRefOutDto | null;
  issuedAt: string | null;
  issuedBy: ProjectRabUserRefOutDto | null;
  wonAt: string | null;
  wonBy: ProjectRabUserRefOutDto | null;
};

export type ProjectQuotationOutDto = ProjectQuotationSummaryOutDto & {
  subject: string;
  markupPercent: string;
  discountType: ProjectQuotationDiscountTypeDto;
  discountValue: string;
  charges: ProjectQuotationChargeDto[];
  validUntil: string | null;
  notes: string;
  termOfPaymentId: string | null;
  termOfPaymentText: string;
  company: ProjectQuotationCompanyOutDto;
  customer: ProjectQuotationCustomerOutDto;
  contact: ProjectCustomerContactDto;
  lines: ProjectQuotationLineOutDto[];
  sections: ProjectQuotationSectionOutDto[];
  /** Issuer full name for "Hormat kami" (issued only). */
  issuedByName: string | null;
  totals: ProjectQuotationTotalsOutDto;
  /** Draft only: RAB moved on since lines were seeded; resync before issuing. */
  rabOutdated: boolean;
  /** Client verification page (issued / superseded with a link). */
  verifyUrl: string | null;
  /** What the client sees when opening the link today. */
  verifyState: "valid" | "expired" | "superseded" | "unavailable";
};

/** What the client link returns: the quotation only while `state` is "valid". */
export type PublicQuotationOutDto = {
  state: "valid" | "expired" | "superseded" | "unavailable";
  quotationNumber: string | null;
  companyName: string | null;
  validUntil: string | null;
  quotation: PublicQuotationDocOutDto | null;
};

export type PublicQuotationDocOutDto = {
  quotationNumber: string;
  revision: number;
  issuedAt: string | null;
  validUntil: string | null;
  subject: string;
  company: {
    name: string;
    npwp: string;
    address: string;
    phone: string;
    email: string;
    website: string;
    branchOfficeAddresses: string[];
    /** Logo available at GET /public/quotation/:token/logo. */
    hasLogo: boolean;
  };
  customer: { name: string; address: string };
  attention: string;
  lines: Array<{
    code: string;
    description: string;
    descriptions: string[];
    dimension: string;
    qty: string;
    uom: string;
    unitPrice: string;
    lineTotal: string;
  }>;
  sections: ProjectQuotationSectionOutDto[];
  issuedByName: string | null;
  discountType: ProjectQuotationDiscountTypeDto;
  discountValue: string;
  totals: {
    subtotal: string;
    discountAmount: string;
    taxBase: string;
    /** Enabled charges only, in printed order. */
    charges: Array<{
      label: string;
      note: string;
      kind: "percent" | "fixed";
      value: string;
      /** Signed: negative when deducted. */
      amount: string;
    }>;
    grandTotal: string;
  };
  termOfPaymentText: string;
  notes: string;
};

export type ProjectQuotationOverviewOutDto = {
  projectId: string;
  rabStatus: "none" | "draft" | "locked";
  rabChangeDraftOpen: boolean;
  currentRabRevision: number;
  /** Null when a draft can be created; otherwise why not. */
  createBlockedReason: string | null;
  revisions: ProjectQuotationSummaryOutDto[];
};
