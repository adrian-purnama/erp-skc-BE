import { Types } from "mongoose";
import { ProductionOrderRepo } from "../../models/productionOrder.model";
import type { ProductionForPurchasing, SpkSnapshot } from "../purchasing";
import { assertRealizationFeeWithinHandover, directToVendorTargets } from "./vendorWork";

const toObjectIds = (ids: readonly string[]) =>
  [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));

async function getSpk(id: string): Promise<SpkSnapshot | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return (await ProductionOrderRepo.model.findById(id).lean().exec()) as SpkSnapshot | null;
}

async function getSpks(ids: readonly string[]): Promise<SpkSnapshot[]> {
  const oids = toObjectIds(ids);
  if (oids.length === 0) return [];
  return (await ProductionOrderRepo.model.find({ _id: { $in: oids } }).lean().exec()) as SpkSnapshot[];
}

const listSpks: ProductionForPurchasing["listSpks"] = async (filter) => {
  const query: Record<string, unknown> = { status: { $in: filter.statuses } };
  if (filter.picUserId) query.picUserId = new Types.ObjectId(filter.picUserId);
  if (filter.projectId) query.projectId = new Types.ObjectId(filter.projectId);
  return (await ProductionOrderRepo.model
    .find(query)
    .sort({ number: 1 })
    .lean()
    .exec()) as SpkSnapshot[];
};

/** Production's implementation of the purchasing module's port. */
export const productionForPurchasing: ProductionForPurchasing = {
  getSpk,
  getSpks,
  listSpks,
  directToVendorTargets,
  assertRealizationFeeWithinHandover,
};
