import type Decimal from "decimal.js";
import { Types } from "mongoose";
import { PurchaseRealizationRepo } from "../../models/purchaseRealization.model";
import { sumRealized } from "./purchaseRealization.planner";

/** Qty arrived per SPP line on posted realizations (Penerimaan / Nota Realisasi). */
export async function arrivedByRequestLine(requestIds: string[]): Promise<Map<string, Decimal>> {
  if (requestIds.length === 0) return new Map();
  const docs = await PurchaseRealizationRepo.model
    .find({
      status: "posted",
      requestId: { $in: requestIds.map((id) => new Types.ObjectId(id)) },
    })
    .select({ lines: 1 })
    .lean()
    .exec();
  return sumRealized(
    docs.flatMap((d) => d.lines.map((l) => ({ poLineId: String(l.requestLineId), qty: l.qty }))),
  );
}
