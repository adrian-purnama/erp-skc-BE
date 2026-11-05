import { Types } from "mongoose";
import { logger } from "../../core/logger";
import { PurchaseOrderRepo } from "../../models/purchaseOrder.model";
import {
  PurchasePaymentRepo,
  type PurchasePaymentInterface,
} from "../../models/purchasePayment.model";
import { usersWithPermission } from "./purchaseOrder.service";
import { STAGE_LABELS } from "./purchasePayment.planner";
import { safeNotify } from "./purchasingNotify";

type LeanPayment = PurchasePaymentInterface & { _id: Types.ObjectId };

export type PaymentNotifyKind = "submitted" | "approved_step" | "rejected" | "paid";

const SOURCE = "modules/purchasing/paymentNotify.ts";
const APPROVALS_LINK = "/dashboard/purchasing/approvals";

function rupiah(digits: string): string {
  const n = Number(digits);
  return Number.isFinite(n) ? `Rp ${new Intl.NumberFormat("id-ID").format(n)}` : digits;
}

function ids(values: Array<Types.ObjectId | null | undefined>, exclude: string): string[] {
  return [...new Set(values.filter(Boolean).map(String))].filter((id) => id !== exclude);
}

/**
 * Inbox + email for payment steps. Approvers hear when it is their turn,
 * finance when it is approved, the requester when it is decided or paid,
 * and a reimbursed staff member when the money went out. Never throws.
 */
export async function notifyPaymentEvent(input: {
  kind: PaymentNotifyKind;
  paymentId: string;
  actorUserId: string;
}): Promise<void> {
  try {
    const doc = (await PurchasePaymentRepo.model.findById(input.paymentId).lean().exec()) as LeanPayment | null;
    if (!doc) return;
    const actor = input.actorUserId;
    const po = await PurchaseOrderRepo.model.findById(doc.purchaseOrderId).select({ number: 1 }).lean().exec();
    const what = `${STAGE_LABELS[doc.stage]} ${doc.kind === "vendor" ? "payment" : "reimbursement"} to ${
      doc.payeeName || "the vendor"
    } for ${po?.number ?? "a PO"}`;
    const summary = `${doc.number} · ${what} · ${rupiah(doc.amount)}`;
    const paymentLink = `/dashboard/finance/payments?payment=${String(doc._id)}`;
    const owner = doc.createdBy ? [doc.createdBy] : [];

    const nextApprovers = (): Array<Types.ObjectId | null | undefined> =>
      doc.status === "pending_approval" ? [doc.approvalLevel === 1 ? doc.approver1Id : doc.approver2Id] : [];

    if (input.kind === "submitted" || (input.kind === "approved_step" && doc.status === "pending_approval")) {
      await safeNotify({
        userIds: ids(nextApprovers(), actor),
        title: `Payment waiting for your approval: ${doc.number}`,
        body: summary,
        link: APPROVALS_LINK,
      });
      return;
    }
    if (doc.status === "approved") {
      const finance = (await usersWithPermission("purchasing.pay")).map((u) => u._id);
      await safeNotify({
        userIds: ids(finance, actor),
        title: `Payment approved, ready to pay: ${doc.number}`,
        body: summary,
        link: paymentLink,
      });
      await safeNotify({
        userIds: ids(owner, actor),
        title: `Your payment request was approved: ${doc.number}`,
        body: summary,
        link: paymentLink,
      });
      return;
    }
    if (input.kind === "rejected" || doc.status === "rejected") {
      await safeNotify({
        userIds: ids(owner, actor),
        title: `Payment rejected: ${doc.number}`,
        body: `${summary} · ${doc.rejectReason || ""}`.trim(),
        link: paymentLink,
      });
      return;
    }
    if (input.kind === "paid") {
      await safeNotify({
        userIds: ids([...owner, doc.payeeUserId], actor),
        title: `Paid: ${doc.number}`,
        body: `${summary} · paid ${doc.paidDate ?? ""}`.trim(),
        link: paymentLink,
      });
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error), SOURCE, "notifyPaymentEvent");
  }
}
