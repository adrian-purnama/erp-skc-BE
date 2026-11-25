import { Types } from "mongoose";
import { PurchaseOrderRepo } from "../../models/purchaseOrder.model";
import { PurchaseRealizationRepo } from "../../models/purchaseRealization.model";
import { allocateRealizationCost, type PurchasingForProject } from "../project";

/** Posted realization cost per project: project ids live on PO lines, realization lines point at them. */
async function realizedCosts(projectIds: string[]): Promise<Array<{ projectId: string; amount: string }>> {
  const ids = projectIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  if (ids.length === 0) return [];
  const pos = await PurchaseOrderRepo.model
    .find({ "lines.projectId": { $in: ids } })
    .select({ "lines._id": 1, "lines.projectId": 1 })
    .lean()
    .exec();
  const projectByPoLine = new Map<string, string>();
  for (const po of pos) {
    for (const line of po.lines ?? []) {
      if (line._id && line.projectId) {
        projectByPoLine.set(String(line._id), String(line.projectId));
      }
    }
  }
  const realizations = await PurchaseRealizationRepo.model
    .find({
      purchaseOrderId: { $in: pos.map((po) => po._id) },
      status: "posted",
    })
    .select({ lines: 1, subtotal: 1, total: 1 })
    .lean()
    .exec();
  return realizations.flatMap((r) =>
    allocateRealizationCost({
      lines: (r.lines ?? []).map((l) => ({
        projectId: projectByPoLine.get(String(l.poLineId)) ?? null,
        qty: l.qty,
        unitPrice: l.unitPrice,
      })),
      subtotal: r.subtotal,
      total: r.total,
    }),
  );
}

/** Purchasing's implementation of the project module's port. */
export const purchasingForProject: PurchasingForProject = { realizedCosts };
