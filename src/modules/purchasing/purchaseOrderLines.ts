import { Types } from "mongoose";
import type { PurchaseOrderStatusDto } from "../../dto/purchasing.dto";
import {
  PURCHASE_ORDER_HOLDING_QUERY,
  PurchaseOrderRepo,
  heldLineQty,
} from "../../models/purchaseOrder.model";

/** One PO line that holds qty against an SPP line. */
export type LiveOrderLine = {
  orderId: string;
  orderNumber: string;
  orderStatus: PurchaseOrderStatusDto;
  requestId: string;
  requestLineId: string;
  qty: string;
};

/**
 * PO lines holding qty for the given SPPs (live POs, and the received part of
 * partly received cancelled ones), optionally leaving one PO out.
 */
export async function liveOrderLines(
  requestIds: Array<string | Types.ObjectId>,
  exceptOrderId?: string,
): Promise<LiveOrderLine[]> {
  if (requestIds.length === 0) return [];
  const ids = requestIds.map((id) => new Types.ObjectId(String(id)));
  const query: Record<string, unknown> = {
    "lines.requestId": { $in: ids },
    ...PURCHASE_ORDER_HOLDING_QUERY,
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
      .filter((l) => wanted.has(String(l.requestId)) && Number(heldLineQty(o.status, l)) > 0)
      .map((l) => ({
        orderId: String(o._id),
        orderNumber: o.number,
        orderStatus: o.status,
        requestId: String(l.requestId),
        requestLineId: String(l.requestLineId),
        qty: heldLineQty(o.status, l),
      })),
  );
}
