import { Types } from "mongoose";
import { logger } from "../../core/logger";
import { MaterialDispatchRepo } from "../../models/materialDispatch.model";
import { ProductionHandoverRepo } from "../../models/productionHandover.model";
import { ProductionOrderRepo } from "../../models/productionOrder.model";
import { PurchaseOrderRepo } from "../../models/purchaseOrder.model";
import { usersWithPermission } from "../purchasing/purchaseOrder.service";
import { safeNotify } from "../purchasing/purchasingNotify";

const SOURCE = "modules/production/productionNotify.ts";

export type DispatchNotifyKind = "submitted" | "approved" | "rejected";

function spkLink(orderId: Types.ObjectId | string): string {
  return `/dashboard/production?spk=${String(orderId)}`;
}

function ids(values: Array<Types.ObjectId | string | null | undefined>, exclude: string): string[] {
  return [...new Set(values.filter(Boolean).map(String))].filter((id) => id !== exclude);
}

/**
 * Surat jalan steps: approvers hear when one waits for them, the requester
 * when it is approved (ready to send) or rejected. Never throws.
 */
export async function notifyDispatchEvent(input: {
  kind: DispatchNotifyKind;
  dispatchId: string;
  actorUserId: string;
}): Promise<void> {
  try {
    const doc = await MaterialDispatchRepo.model.findById(input.dispatchId).lean().exec();
    if (!doc) return;
    const order = await ProductionOrderRepo.model.findById(doc.productionOrderId).select({ number: 1 }).lean().exec();
    const summary = `${doc.number} · ${order?.number ?? "SPK"} · ${doc.lines.length} material(s) to the subcon vendor`;
    const link = spkLink(doc.productionOrderId);
    if (input.kind === "submitted") {
      const approvers = (await usersWithPermission("production.dispatchApprove")).map((u) => u._id);
      await safeNotify({
        userIds: ids(approvers, String(doc.createdBy ?? input.actorUserId)),
        title: `Surat jalan waiting for your approval: ${doc.number}`,
        body: summary,
        link,
      });
      return;
    }
    await safeNotify({
      userIds: ids([doc.createdBy], input.actorUserId),
      title:
        input.kind === "approved"
          ? `Surat jalan approved, ready to send: ${doc.number}`
          : `Surat jalan rejected: ${doc.number}`,
      body: input.kind === "approved" ? summary : `${summary} · ${doc.rejectReason ?? ""}`.trim(),
      link,
    });
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error), SOURCE, "notifyDispatchEvent");
  }
}

/**
 * A posted handover: purchasing (the fee PO's creator) can now receive that
 * share of the vendor fee, and the SPK's PIC sees progress. Never throws.
 */
export async function notifyHandoverPosted(input: { handoverId: string; actorUserId: string }): Promise<void> {
  try {
    const doc = await ProductionHandoverRepo.model.findById(input.handoverId).lean().exec();
    if (!doc) return;
    const order = await ProductionOrderRepo.model
      .findById(doc.productionOrderId)
      .select({ number: 1, qty: 1, picUserId: 1 })
      .lean()
      .exec();
    const feePos = await PurchaseOrderRepo.model
      .find({ "lines.productionOrderId": doc.productionOrderId, status: "approved" })
      .select({ createdBy: 1 })
      .lean()
      .exec();
    await safeNotify({
      userIds: ids([...feePos.map((p) => p.createdBy), order?.picUserId], input.actorUserId),
      title: `Vendor handed over ${doc.qty} unit(s): ${order?.number ?? "SPK"}`,
      body: `${doc.number} · ${doc.qty} of ${order?.qty ?? "?"} on ${order?.number ?? "the SPK"}. That share of the vendor fee can now be received.`,
      link: spkLink(doc.productionOrderId),
    });
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error), SOURCE, "notifyHandoverPosted");
  }
}
