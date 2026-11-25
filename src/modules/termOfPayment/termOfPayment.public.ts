import { Types } from "mongoose";
import { TermOfPaymentRepo } from "../../models/termOfPayment.model";

/** A term of payment as other modules see it. `isActive` applies the rule (unset = active). */
export type TermOfPaymentRefDto = {
  id: string;
  label: string;
  isActive: boolean;
};

type TermLean = { _id: Types.ObjectId; termOfPayment: string; isActive?: boolean };

const toRef = (t: TermLean): TermOfPaymentRefDto => ({
  id: String(t._id),
  label: t.termOfPayment,
  isActive: t.isActive !== false,
});

/** One term by id (any status), or null. */
export async function getTermOfPayment(
  id: Types.ObjectId | string | null | undefined,
): Promise<TermOfPaymentRefDto | null> {
  if (!id || !Types.ObjectId.isValid(String(id))) return null;
  const doc = (await TermOfPaymentRepo.model
    .findById(id)
    .select({ termOfPayment: 1, isActive: 1 })
    .lean()
    .exec()) as TermLean | null;
  return doc ? toRef(doc) : null;
}

/** Active terms, A→Z, for pickers. */
export async function listActiveTermsOfPayment(): Promise<TermOfPaymentRefDto[]> {
  const docs = (await TermOfPaymentRepo.model
    .find({ isActive: { $ne: false } })
    .select({ termOfPayment: 1, isActive: 1 })
    .sort({ termOfPayment: 1 })
    .lean()
    .exec()) as TermLean[];
  return docs.map(toRef);
}
