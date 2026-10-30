import { Types } from "mongoose";
import { logger } from "../../core/logger";
import {
  PurchaseOrderRepo,
  type PurchaseOrderInterface,
} from "../../models/purchaseOrder.model";
import { PurchaseRealizationRepo } from "../../models/purchaseRealization.model";
import { PurchaseRequestRepo } from "../../models/purchaseRequest.model";
import { notificationService } from "../notification/notification.service";
import {
  realizationStatus,
  sumRealized,
  type RealizationStatus,
} from "./purchaseRealization.planner";

type LeanOrder = PurchaseOrderInterface & { _id: Types.ObjectId };

export type PurchaseOrderNotifyKind =
  | "po_submitted"
  | "po_l1_approved"
  | "po_fully_approved"
  | "po_rejected"
  | "goods_received";

const SOURCE = "modules/purchasing/purchasingNotify.ts";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function idStr(value: Types.ObjectId | string | null | undefined): string | null {
  if (!value) return null;
  return String(value);
}

function uniqueIds(
  ids: Array<string | null | undefined>,
  exclude?: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (!raw || !Types.ObjectId.isValid(raw)) continue;
    if (exclude && raw === exclude) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

function formatWhen(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function receiptLabel(status: RealizationStatus): string {
  if (status === "full") return "Goods fully received";
  if (status === "partial") return "Goods partially received";
  return "Goods not received yet";
}

async function loadOrder(orderId: string): Promise<LeanOrder | null> {
  if (!Types.ObjectId.isValid(orderId)) return null;
  return (await PurchaseOrderRepo.model
    .findById(orderId)
    .lean()
    .exec()) as LeanOrder | null;
}

async function sppCreatorId(requestId: Types.ObjectId): Promise<string | null> {
  const request = await PurchaseRequestRepo.model
    .findById(requestId)
    .select({ createdBy: 1 })
    .lean()
    .exec();
  return idStr(request?.createdBy);
}

async function orderReceiptStatus(order: LeanOrder): Promise<RealizationStatus> {
  const posted = await PurchaseRealizationRepo.model
    .find({ purchaseOrderId: order._id, status: "posted" })
    .select({ lines: 1 })
    .lean()
    .exec();
  const realized = sumRealized(
    posted.flatMap((n) =>
      n.lines.map((l) => ({ poLineId: String(l.poLineId), qty: l.qty })),
    ),
  );
  return realizationStatus(
    order.lines.map((l) => ({
      qty: l.qty,
      realized: realized.get(String(l._id)),
    })),
  );
}

function buildPoTimelineHtml(
  order: LeanOrder,
  receipt: RealizationStatus,
): string {
  type Step = { label: string; detail: string; done: boolean; active?: boolean };

  const rejected = order.status === "rejected";
  const steps: Step[] = [
    {
      label: "Order sent for approval",
      detail: order.submittedAt
        ? `Submitted ${formatWhen(order.submittedAt)}`
        : "Waiting to be sent",
      done: Boolean(order.submittedAt),
    },
  ];

  if (rejected && !order.approved1At) {
    steps.push({
      label: "Order rejected",
      detail: order.rejectReason?.trim()
        ? order.rejectReason.trim()
        : `Rejected ${formatWhen(order.rejectedAt)}`,
      done: true,
      active: true,
    });
  } else {
    steps.push({
      label: "Level 1 approved",
      detail: order.approved1At
        ? `${order.approved1ByName?.trim() || "Approver"} · ${formatWhen(order.approved1At)}`
        : "Waiting for level 1",
      done: Boolean(order.approved1At),
      active: order.status === "pending_approval" && order.approvalLevel === 1,
    });

    if (rejected && order.approved1At) {
      steps.push({
        label: "Order rejected",
        detail: order.rejectReason?.trim()
          ? order.rejectReason.trim()
          : `Rejected ${formatWhen(order.rejectedAt)}`,
        done: true,
        active: true,
      });
    } else {
      steps.push({
        label: "Level 2 approved",
        detail: order.approvedAt
          ? `${order.approvedByName?.trim() || "Approver"} · ${formatWhen(order.approvedAt)}`
          : "Waiting for level 2",
        done: Boolean(order.approvedAt),
        active: order.status === "pending_approval" && order.approvalLevel === 2,
      });
      steps.push({
        label: receiptLabel(receipt),
        detail:
          receipt === "full"
            ? "All ordered quantities have arrived"
            : receipt === "partial"
              ? "Some quantities have arrived"
              : "No posted receipt yet",
        done: receipt !== "none",
        active: order.status === "approved" && receipt !== "full",
      });
    }
  }

  const rows = steps
    .map((step, index) => {
      const isLast = index === steps.length - 1;
      const dot = step.done
        ? "#0f766e"
        : step.active
          ? "#f59e0b"
          : "#cbd5e1";
      return `
        <tr>
          <td style="width:20px;vertical-align:top;padding:0 12px 0 0;">
            <div style="width:10px;height:10px;margin:4px auto 0;border-radius:999px;background-color:${dot};"></div>
            ${
              isLast
                ? ""
                : `<div style="width:2px;height:100%;min-height:28px;margin:4px auto 0;background-color:#e2e8f0;"></div>`
            }
          </td>
          <td style="padding:0 0 ${isLast ? "0" : "16px"} 0;vertical-align:top;">
            <p style="margin:0;font-family:${SANS};font-size:14px;font-weight:600;line-height:1.4;color:#0f172a;">
              ${escapeHtml(step.label)}
            </p>
            <p style="margin:4px 0 0;font-family:${SANS};font-size:13px;line-height:1.5;color:#64748b;">
              ${escapeHtml(step.detail)}
            </p>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.6;color:#334155;">
      Purchase order <strong>${escapeHtml(order.number)}</strong>
    </p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      ${rows}
    </table>
  `;
}

export async function safeNotify(input: {
  userIds: string[];
  title: string;
  body: string;
  link: string;
  html?: string | null;
}): Promise<void> {
  if (input.userIds.length === 0) return;
  try {
    await notificationService.notify({
      userIds: input.userIds,
      title: input.title,
      body: input.body,
      link: input.link,
      html: input.html,
      channels: ["in_app", "email"],
    });
  } catch (error) {
    logger.error(
      error instanceof Error ? error.message : String(error),
      SOURCE,
      "safeNotify",
    );
  }
}

/**
 * Fire inbox + email alerts for a PO approval / goods step.
 * Never throws to the caller.
 */
export async function notifyPurchaseOrderEvent(input: {
  kind: PurchaseOrderNotifyKind;
  orderId: string;
  actorUserId: string;
  realizationNumber?: string;
}): Promise<void> {
  try {
    const order = await loadOrder(input.orderId);
    if (!order) return;

    const [sppCreator, receipt] = await Promise.all([
      sppCreatorId(order.requestId),
      orderReceiptStatus(order),
    ]);

    const orderLink = `/dashboard/purchasing/orders/${String(order._id)}`;
    const approvalLink = `/dashboard/purchasing/approvals/${String(order._id)}`;
    const submitter =
      idStr(order.submittedBy) ?? idStr(order.createdBy);
    const poCreator = idStr(order.createdBy);
    const approver1 = idStr(order.approver1Id);
    const approver2 = idStr(order.approver2Id);
    const actor = input.actorUserId;
    const timelineHtml = buildPoTimelineHtml(order, receipt);

    let primaryTitle = "";
    let primaryBody = "";
    let sppTitle = "";
    let sppBody = "";
    let primaryIds: string[] = [];
    let primaryLink = orderLink;

    switch (input.kind) {
      case "po_submitted":
        primaryTitle = `Approval needed: ${order.number}`;
        primaryBody = `Purchase order ${order.number} was sent for level 1 approval.`;
        sppTitle = `Order sent for approval: ${order.number}`;
        sppBody = `Your purchase request’s order ${order.number} was sent for approval.`;
        primaryIds = uniqueIds([approver1], actor);
        primaryLink = approvalLink;
        break;
      case "po_l1_approved":
        primaryTitle = `Level 2 approval needed: ${order.number}`;
        primaryBody = `Purchase order ${order.number} was approved at level 1 and needs level 2.`;
        sppTitle = `Level 1 approved: ${order.number}`;
        sppBody = `Order ${order.number} was approved at level 1 and is waiting for level 2.`;
        primaryIds = uniqueIds([approver2], actor);
        primaryLink = approvalLink;
        break;
      case "po_fully_approved":
        primaryTitle = `Order approved: ${order.number}`;
        primaryBody = `Purchase order ${order.number} was fully approved.`;
        sppTitle = primaryTitle;
        sppBody = `Order ${order.number} was fully approved by both approvers.`;
        primaryIds = uniqueIds([submitter], actor);
        break;
      case "po_rejected": {
        const reason = order.rejectReason?.trim() || "No reason given";
        primaryTitle = `Order rejected: ${order.number}`;
        primaryBody = `Purchase order ${order.number} was rejected: ${reason}`;
        sppTitle = primaryTitle;
        sppBody = `Order ${order.number} was rejected: ${reason}`;
        primaryIds = uniqueIds([submitter], actor);
        break;
      }
      case "goods_received": {
        const nota = input.realizationNumber?.trim();
        const statusWord =
          receipt === "full"
            ? "fully received"
            : receipt === "partial"
              ? "partially received"
              : "updated";
        primaryTitle = `Goods ${statusWord}: ${order.number}`;
        primaryBody = nota
          ? `Goods for ${order.number} are ${statusWord} (nota ${nota}).`
          : `Goods for ${order.number} are ${statusWord}.`;
        sppTitle = primaryTitle;
        sppBody = primaryBody;
        primaryIds = uniqueIds([poCreator], actor);
        break;
      }
      default:
        return;
    }

    const sppIds = uniqueIds([sppCreator], actor);
    const primaryWithoutSpp = primaryIds.filter((id) => !sppIds.includes(id));

    await safeNotify({
      userIds: primaryWithoutSpp,
      title: primaryTitle,
      body: primaryBody,
      link: primaryLink,
    });

    await safeNotify({
      userIds: sppIds,
      title: sppTitle,
      body: sppBody,
      link: orderLink,
      html: timelineHtml,
    });
  } catch (error) {
    logger.error(
      error instanceof Error ? error.message : String(error),
      SOURCE,
      "notifyPurchaseOrderEvent",
    );
  }
}
