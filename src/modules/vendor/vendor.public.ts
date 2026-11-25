import { Types } from "mongoose";
import { VendorRepo } from "../../models/vendor.model";

/** A vendor as other modules see it. `isActive` applies the vendor rule (unset = active). */
export type VendorRefDto = {
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

type VendorLean = {
  _id: Types.ObjectId;
  name: string;
  address?: string;
  npwp?: string;
  isActive?: boolean;
};

const FIELDS = { name: 1, address: 1, npwp: 1, isActive: 1 } as const;

function toRef(doc: VendorLean): VendorRefDto {
  return {
    id: String(doc._id),
    name: doc.name,
    address: doc.address ?? "",
    npwp: doc.npwp ?? "",
    isActive: doc.isActive !== false,
  };
}

/** Vendors by id (any status), keyed by id. Unknown ids are absent. */
export async function getVendorRefs(ids: readonly IdLike[]): Promise<Map<string, VendorRefDto>> {
  const oids = toObjectIds(ids);
  if (oids.length === 0) return new Map();
  const docs = (await VendorRepo.model
    .find({ _id: { $in: oids } })
    .select(FIELDS)
    .lean()
    .exec()) as VendorLean[];
  return new Map(docs.map((d) => [String(d._id), toRef(d)]));
}

export async function getVendorRef(id: IdLike): Promise<VendorRefDto | null> {
  return (await getVendorRefs([id])).values().next().value ?? null;
}

/** Vendor display names by id. */
export async function getVendorNames(ids: readonly IdLike[]): Promise<Map<string, string>> {
  const refs = await getVendorRefs(ids);
  return new Map([...refs].map(([id, v]) => [id, v.name]));
}

/** Active vendors, A→Z, for pickers and imports. */
export async function listActiveVendors(): Promise<VendorRefDto[]> {
  const docs = (await VendorRepo.model
    .find({ isActive: { $ne: false } })
    .select(FIELDS)
    .sort({ name: 1 })
    .lean()
    .exec()) as VendorLean[];
  return docs.map(toRef);
}

/** Every id must be an existing, active vendor; one error lists all offenders. */
export async function assertVendorsActive(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const refs = await getVendorRefs(ids);
  const bad: string[] = [];
  for (const id of ids) {
    const ref = refs.get(id);
    if (!ref) {
      bad.push(`${id} (not found)`);
      continue;
    }
    if (!ref.isActive) bad.push(`${ref.name || id} (disabled)`);
  }
  if (bad.length > 0) {
    throw new Error(`Invalid or inactive vendors: ${bad.join(", ")}`);
  }
}
