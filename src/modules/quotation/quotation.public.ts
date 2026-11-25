import { Types } from "mongoose";
import { ProjectQuotationRepo } from "../../models/projectQuotation.model";

/** The quotation a project was won with. */
export type WonQuotationRefDto = { revision: number; quotationNumber: string };

/** The project's won quotation, or null while none is won. */
export async function getWonQuotationRef(projectId: string): Promise<WonQuotationRefDto | null> {
  const won = await ProjectQuotationRepo.model
    .findOne({ projectId: new Types.ObjectId(projectId), status: "won" })
    .select({ revision: 1, quotationNumber: 1 })
    .lean()
    .exec();
  return won ? { revision: won.revision, quotationNumber: won.quotationNumber } : null;
}
