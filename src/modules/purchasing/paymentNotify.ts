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
  /** Reimbursements: the nota that was just decided. */
  itemId?: string;
}): Promise<void> {
  try {
    const doc = (await PurchasePaymentRepo.model.findById(input.paymentId).lean().exec()) as LeanPayment | null;
    if (!doc) return;
    const actor = input.actorUserId;
    const po = doc.purchaseOrderId
      ? await PurchaseOrderRepo.model.findById(doc.purchaseOrderId).select({ number: 1 }).lean().exec()
      : null;
    const what =
      doc.kind === "vendor"
        ? `${doc.stage ? STAGE_LABELS[doc.stage] : "Payment"} for ${po?.number ?? "a PO"}`
        : `Reimbursement to ${doc.payeeName}`;
    const summary = `${doc.number} · ${what} · ${rupiah(doc.amount)}`;
    const paymentLink = `/dashboard/finance/payments?payment=${String(doc._id)}`;
    const owner = doc.createdBy ? [doc.createdBy] : [];

    // Who signs next: the whole stage, or the notas still waiting at this level.
    const nextApprovers = (): Array<Types.ObjectId | null | undefined> => {
      if (doc.status !== "pending_approval") return [];
      if (doc.kind === "vendor") {
        return [doc.approvalLevel === 1 ? doc.approver1Id : doc.approver2Id];
      }
      return doc.items
        .filter((i) => i.status === "pending" && (!input.itemId || String(i._id) === input.itemId || input.kind === "submitted"))
        .map((i) => (i.approvalLevel === 1 ? i.approver1Id : i.approver2Id));
    };

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
      const item = input.itemId ? doc.items.find((i) => String(i._id) === input.itemId) : null;
      await safeNotify({
        userIds: ids(owner, actor),
        title: `${item ? "A nota was rejected" : "Payment rejected"}: ${doc.number}`,
        body: `${summary} · ${item?.rejectReason || doc.rejectReason || ""}`.trim(),
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
