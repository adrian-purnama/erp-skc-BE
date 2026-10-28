import type Decimal from "decimal.js";
import { Types } from "mongoose";
import { GoodsReceiptRepo } from "../../models/goodsReceipt/goodsReceipt.model";
import { sumRealized } from "./purchaseRealization.planner";

type Scope = { purchaseOrderId?: string[]; requestId?: string[] };

async function postedLines(scope: Scope) {
  const query: Record<string, unknown> = { status: "posted" };
  if (scope.purchaseOrderId) {
    query.purchaseOrderId = { $in: scope.purchaseOrderId.map((id) => new Types.ObjectId(id)) };
  }
  if (scope.requestId) {
    query.requestId = { $in: scope.requestId.map((id) => new Types.ObjectId(id)) };
  }
  const docs = await GoodsReceiptRepo.model.find(query).select({ lines: 1 }).lean().exec();
  return docs.flatMap((d) => d.lines);
}

/** Qty arrived per PO line on posted receipts. */
export async function receivedByPoLine(orderIds: string[]): Promise<Map<string, Decimal>> {
  if (orderIds.length === 0) return new Map();
  const lines = await postedLines({ purchaseOrderId: orderIds });
  return sumRealized(lines.map((l) => ({ poLineId: String(l.poLineId), qty: l.qty })));
}

/** Qty arrived per SPP line on posted receipts. */
export async function receivedByRequestLine(requestIds: string[]): Promise<Map<string, Decimal>> {
  if (requestIds.length === 0) return new Map();
  const lines = await postedLines({ requestId: requestIds });
  return sumRealized(lines.map((l) => ({ poLineId: String(l.requestLineId), qty: l.qty })));
}
