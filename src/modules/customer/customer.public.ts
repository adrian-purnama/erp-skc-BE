import { Types } from "mongoose";
import { CustomerRepo } from "../../models/customer.model";

/** A customer as other modules see it. `isActive` applies the customer rule (unset = active). */
export type CustomerRefDto = {
  id: string;
  name: string;
  address: string;
  npwp: string;
  isActive: boolean;
};

type IdLike = Types.ObjectId | string | null | undefined;

const toObjectIds = (ids: readonly IdLike[]) =>
  [...new Set(ids.filter(Boolean).map(String))]
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

type CustomerLean = {
  _id: Types.ObjectId;
  name: string;
  address?: string;
  npwp?: string;
  isActive?: boolean;
};

/** Customers by id (any status), keyed by id. Unknown ids are absent. */
export async function getCustomerRefs(ids: readonly IdLike[]): Promise<Map<string, CustomerRefDto>> {
  const oids = toObjectIds(ids);
  if (oids.length === 0) return new Map();
  const docs = (await CustomerRepo.model
    .find({ _id: { $in: oids } })
    .select({ name: 1, address: 1, npwp: 1, isActive: 1 })
    .lean()
    .exec()) as CustomerLean[];
  return new Map(
    docs.map((d) => [
      String(d._id),
      {
        id: String(d._id),
        name: d.name,
        address: d.address ?? "",
        npwp: d.npwp ?? "",
        isActive: d.isActive !== false,
      },
    ]),
  );
}

export async function getCustomerRef(id: IdLike): Promise<CustomerRefDto | null> {
  return (await getCustomerRefs([id])).values().next().value ?? null;
}

/** Customer display names by id. */
export async function getCustomerNames(ids: readonly IdLike[]): Promise<Map<string, string>> {
  const refs = await getCustomerRefs(ids);
  return new Map([...refs].map(([id, c]) => [id, c.name]));
}
