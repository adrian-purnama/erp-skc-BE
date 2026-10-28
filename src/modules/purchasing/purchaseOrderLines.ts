import { Types } from "mongoose";
import type { PurchaseOrderStatusDto } from "../../dto/purchasing.dto";
import {
  PURCHASE_ORDER_LIVE_STATUSES,
  PurchaseOrderRepo,
} from "../../models/purchaseOrder/purchaseOrder.model";

/** One PO line that holds qty against an SPP line. */
export type LiveOrderLine = {
  orderId: string;
  orderNumber: string;
  orderStatus: PurchaseOrderStatusDto;
  requestId: string;
  requestLineId: string;
  qty: string;
};

/** PO lines on live POs for the given SPPs, optionally leaving one PO out. */
export async function liveOrderLines(
  requestIds: Array<string | Types.ObjectId>,
  exceptOrderId?: string,
): Promise<LiveOrderLine[]> {
  if (requestIds.length === 0) return [];
  const ids = requestIds.map((id) => new Types.ObjectId(String(id)));
  const query: Record<string, unknown> = {
    "lines.requestId": { $in: ids },
    status: { $in: PURCHASE_ORDER_LIVE_STATUSES },
  };
  if (exceptOrderId) query._id = { $ne: new Types.ObjectId(exceptOrderId) };
  const orders = await PurchaseOrderRepo.model
    .find(query)
    .select({ number: 1, status: 1, lines: 1 })
    .lean()
    .exec();
  const wanted = new Set(ids.map(String));
  return orders.flatMap((o) =>
    o.lines
      .filter((l) => wanted.has(String(l.requestId)))
      .map((l) => ({
        orderId: String(o._id),
        orderNumber: o.number,
        orderStatus: o.status,
        requestId: String(l.requestId),
        requestLineId: String(l.requestLineId),
        qty: l.qty,
      })),
  );
}
