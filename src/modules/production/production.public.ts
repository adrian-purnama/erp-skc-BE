import { Types } from "mongoose";
import {
  ProductionOrderRepo,
  type ProductionOrderInterface,
} from "../../models/productionOrder.model";
import { ProductionReportRepo } from "../../models/productionReport.model";

/** An SPK is live until it is cancelled. */
export const LIVE_ORDER_FILTER = { status: { $ne: "cancelled" } } as const;

/** A progress report counts unless it was voided. */
export const VALID_REPORT_FILTER = { isVoided: false } as const;

/** An SPK as other modules see it (plain data, string ids). */
export type ProductionOrderRefDto = {
  id: string;
  projectId: string;
  shopDrawingItemId: string;
  labourItemId: string;
  labourUomId: string;
  labourName: string;
  role: ProductionOrderInterface["role"];
  executor: ProductionOrderInterface["executor"];
  status: ProductionOrderInterface["status"];
  qty: string;
  plannedFinish: string | null;
  /** Make qty frozen on the SPK when issued, if any. */
  makeQty: string | null;
};

/** A valid (not voided) progress report as other modules see it. */
export type ProductionReportRefDto = {
  id: string;
  projectId: string;
  productionOrderId: string;
  shopDrawingItemId: string;
  qtyDone: string;
  reportDate: string;
};

const toObjectIds = (ids: readonly string[]) =>
  [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));

/** SPKs of these projects; live ones only unless `includeCancelled`. */
export async function listProductionOrders(
  projectIds: readonly string[],
  opts: { includeCancelled?: boolean } = {},
): Promise<ProductionOrderRefDto[]> {
  const ids = toObjectIds(projectIds);
  if (ids.length === 0) return [];
  const docs = await ProductionOrderRepo.model
    .find({
      projectId: { $in: ids },
      ...(opts.includeCancelled ? {} : LIVE_ORDER_FILTER),
    })
    .select({
      projectId: 1,
      shopDrawingItemId: 1,
      labourItemId: 1,
      labourUomId: 1,
      labourName: 1,
      role: 1,
      executor: 1,
      status: 1,
      qty: 1,
      plannedFinish: 1,
      "snapshot.makeQty": 1,
    })
    .lean()
    .exec();
  return docs.map((o) => ({
    id: String(o._id),
    projectId: String(o.projectId),
    shopDrawingItemId: String(o.shopDrawingItemId),
    labourItemId: String(o.labourItemId),
    labourUomId: String(o.labourUomId),
    labourName: o.labourName ?? "",
    role: o.role,
    executor: o.executor,
    status: o.status,
    qty: o.qty,
    plannedFinish: o.plannedFinish ?? null,
    makeQty: o.snapshot?.makeQty ?? null,
  }));
}

/** Live SPKs on one shop drawing item (they pin how the item is made). */
export async function countLiveOrdersForShopDrawingItem(itemId: string): Promise<number> {
  if (!Types.ObjectId.isValid(itemId)) return 0;
  return ProductionOrderRepo.model
    .countDocuments({ shopDrawingItemId: new Types.ObjectId(itemId), ...LIVE_ORDER_FILTER })
    .exec();
}

/** Valid progress reports, by project and/or by SPK. */
export async function listValidReports(by: {
  projectIds?: readonly string[];
  orderIds?: readonly string[];
}): Promise<ProductionReportRefDto[]> {
  const filter: Record<string, unknown> = { ...VALID_REPORT_FILTER };
  if (by.projectIds) filter.projectId = { $in: toObjectIds(by.projectIds) };
  if (by.orderIds) filter.productionOrderId = { $in: toObjectIds(by.orderIds) };
  if (!by.projectIds && !by.orderIds) return [];
  if (
    (by.projectIds && by.projectIds.length === 0) ||
    (by.orderIds && by.orderIds.length === 0)
  ) {
    return [];
  }
  const docs = await ProductionReportRepo.model
    .find(filter)
    .select({ projectId: 1, productionOrderId: 1, shopDrawingItemId: 1, qtyDone: 1, reportDate: 1 })
    .lean()
    .exec();
  return docs.map((r) => ({
    id: String(r._id),
    projectId: String(r.projectId),
    productionOrderId: String(r.productionOrderId),
    shopDrawingItemId: String(r.shopDrawingItemId),
    qtyDone: r.qtyDone,
    reportDate: r.reportDate,
  }));
}
