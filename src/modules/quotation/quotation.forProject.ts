import { Types } from "mongoose";
import { ProjectQuotationRepo } from "../../models/projectQuotation.model";
import type { ContractQuotationFigures, QuotationForProject } from "../project";
import {
  computeTotals,
  quotationCharges,
  type QuotationCharge,
  type QuotationDiscountType,
} from "./quotation.planner";

type SummaryQuotationLean = {
  projectId: Types.ObjectId;
  status: string;
  revision: number;
  discountType: QuotationDiscountType;
  discountValue: string;
  charges?: QuotationCharge[] | null;
  taxPercent?: string | null;
  lines?: Array<{ qty: string; unitPrice: string; costUnitPrice: string }>;
};

/** A project is won only through a won quotation. */
async function hasWonQuotation(projectId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(projectId)) return false;
  const won = await ProjectQuotationRepo.model.exists({
    projectId: new Types.ObjectId(projectId),
    status: "won",
  });
  return won !== null;
}

/** Won and issued quotations of these projects, priced by quotation's own rules. */
async function contractQuotations(projectIds: string[]): Promise<ContractQuotationFigures[]> {
  const ids = projectIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  if (ids.length === 0) return [];
  const docs = (await ProjectQuotationRepo.model
    .find({ projectId: { $in: ids }, status: { $in: ["won", "issued"] } })
    .select({
      projectId: 1,
      status: 1,
      revision: 1,
      discountType: 1,
      discountValue: 1,
      charges: 1,
      taxPercent: 1,
      "lines.qty": 1,
      "lines.unitPrice": 1,
      "lines.costUnitPrice": 1,
    })
    .lean()
    .exec()) as SummaryQuotationLean[];
  return docs.map((q) => {
    const totals = computeTotals({
      lines: q.lines ?? [],
      discountType: q.discountType,
      discountValue: q.discountValue,
      charges: quotationCharges(q),
    });
    return {
      projectId: String(q.projectId),
      status: q.status,
      revision: q.revision,
      taxBase: totals.taxBase,
      grandTotal: totals.grandTotal,
    };
  });
}

/** Quotation's implementation of the project module's port. */
export const quotationForProject: QuotationForProject = { hasWonQuotation, contractQuotations };
