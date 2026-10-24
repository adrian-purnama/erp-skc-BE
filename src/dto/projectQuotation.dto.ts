import type { ProjectCustomerContactDto } from "./project.dto";
import type { ProjectRabUserRefOutDto } from "./projectRab.dto";

export type ProjectQuotationStatusDto = "draft" | "issued" | "superseded";
export type ProjectQuotationDiscountTypeDto = "percent" | "amount";

export type UpdateProjectQuotationInDto = {
  subject?: string;
  markupPercent?: string;
  discountType?: ProjectQuotationDiscountTypeDto;
  discountValue?: string;
  taxPercent?: string;
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
};

export type ProjectQuotationTotalsOutDto = {
  costTotal: string;
  subtotal: string;
  discountAmount: string;
  /** Subtotal after discount (DPP). */
  taxBase: string;
  taxAmount: string;
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
};

export type ProjectQuotationOutDto = ProjectQuotationSummaryOutDto & {
  subject: string;
  markupPercent: string;
  discountType: ProjectQuotationDiscountTypeDto;
  discountValue: string;
  taxPercent: string;
  validUntil: string | null;
  notes: string;
  termOfPaymentId: string | null;
  termOfPaymentText: string;
  company: ProjectQuotationCompanyOutDto;
  customer: ProjectQuotationCustomerOutDto;
  contact: ProjectCustomerContactDto;
  lines: ProjectQuotationLineOutDto[];
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
    /** Logo available at GET /public/quotation/:token/logo. */
    hasLogo: boolean;
  };
  customer: { name: string; address: string };
  attention: string;
  lines: Array<{
    description: string;
    qty: string;
    uom: string;
    unitPrice: string;
    lineTotal: string;
  }>;
  discountType: ProjectQuotationDiscountTypeDto;
  discountValue: string;
  taxPercent: string;
  totals: {
    subtotal: string;
    discountAmount: string;
    taxBase: string;
    taxAmount: string;
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
