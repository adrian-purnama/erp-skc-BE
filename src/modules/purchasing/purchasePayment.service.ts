import Decimal from "decimal.js";
import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import { deleteFileIfExists, findFile, openDownload, uploadFile } from "../../core/gridfs";
import { logger } from "../../core/logger";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import type {
  PayablePurchaseOrderOutDto,
  PaymentApprovalOutDto,
  PayPurchasePaymentInDto,
  PurchaseOrderPaymentsOutDto,
  PurchasePaymentKindDto,
  PurchasePaymentOutDto,
  PurchasePaymentStatusDto,
  ReimbursableNotaOutDto,
  SaveReimbursementInDto,
  SaveVendorPaymentInDto,
} from "../../dto/purchasing.dto";
import {
  PurchaseOrderRepo,
  type PurchaseOrderApprovalLevel,
  type PurchaseOrderInterface,
} from "../../models/purchaseOrder.model";
import {
  PURCHASE_PAYMENT_LIVE_STATUSES,
  PurchasePaymentRepo,
  type PaymentApproval,
  type PurchasePaymentInterface,
  type ReimburseItem,
} from "../../models/purchasePayment.model";
import {
  PurchaseRealizationRepo,
  type PurchaseRealizationInterface,
} from "../../models/purchaseRealization.model";
import { PurchasingSeqCounterModel } from "../../models/seqCounter.model";
import { UserModel } from "../../models/user.model";
import { VendorRepo } from "../../models/vendor.model";
import { jakartaYmdString, userEmailsById } from "../../utils/shared";
import { projectNumberParts } from "../project/projectNumber";
import {
  APPROVE_PERM,
  PURCHASING_BUCKET,
  estimatesOf,
  userHasPermission,
  type PoActor,
} from "./purchaseOrder.service";
import {
  checkVendorStage,
  priceStage,
  reimbursementOutcome,
  sumAmounts,
  vendorPayable,
} from "./purchasePayment.planner";
import { realizationStatus, sumRealized } from "./purchaseRealization.planner";
import { notifyPaymentEvent } from "./paymentNotify";

type LeanPayment = PurchasePaymentInterface & { _id: Types.ObjectId };
type LeanOrder = PurchaseOrderInterface & { _id: Types.ObjectId };
type LeanRealization = PurchaseRealizationInterface & { _id: Types.ObjectId };

const PROOF_MAX = 12;
const PROOF_MAX_BYTES = 15 * 1024 * 1024;
const PROOF_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

/** Reset when a payment leaves the approval flow: both levels approve again next time. */
const CLEAR_APPROVAL: PaymentApproval = {
  approvalLevel: null,
  approved1At: null,
  approved1By: null,
  approved1ByName: "",
};

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function allocateNumber(): Promise<string> {
  const parts = projectNumberParts();
  const scopeKey = `pay:${parts.scopeKey}`;
  const counter = await PurchasingSeqCounterModel.findOneAndUpdate(
    { scopeKey },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey } },
    { upsert: true, new: true },
  ).exec();
  if (!counter || counter.nextSeq < 1) throw new Error("Failed to allocate payment number");
  return `PAY/${parts.roman}/${parts.year}/${String(counter.nextSeq).padStart(4, "0")}`;
}

async function requirePayment(id: string): Promise<LeanPayment> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid payment id");
  const doc = (await PurchasePaymentRepo.model.findById(id).lean().exec()) as LeanPayment | null;
  if (!doc) throw new Error("Payment not found");
  return doc;
}

async function requireOrder(id: string | Types.ObjectId): Promise<LeanOrder> {
  const doc = (await PurchaseOrderRepo.model.findById(id).lean().exec()) as LeanOrder | null;
  if (!doc) throw new Error("PO not found");
  return doc;
}

async function displayName(userId: string): Promise<string> {
  const user = await UserModel.findById(userId).select({ fullName: 1, email: 1 }).lean().exec();
  if (!user) throw new Error("User not found");
  return user.fullName?.trim() || user.email || "";
}

function assertOwner(doc: LeanPayment, actor: PoActor): void {
  if (!actor.superAdmin && String(doc.createdBy) !== actor.userId) {
    throw new Error("Only the person who made this payment request can change it");
  }
}

function assertEditable(doc: LeanPayment): void {
  if (doc.status !== "draft" && doc.status !== "rejected") {
    throw new Error("Only a draft or rejected payment can be changed");
  }
}

/** Who a level 1 → 2 approval waits on now. */
function awaiting(a: PaymentApproval, waiting: boolean): string | null {
  if (!waiting) return null;
  const id = a.approvalLevel === 1 ? a.approver1Id : a.approvalLevel === 2 ? a.approver2Id : null;
  return id ? String(id) : null;
}

/** The chosen approver of the level it waits on, still holding that permission, not the requester. */
async function assertApprover(
  a: PaymentApproval,
  waiting: boolean,
  userId: string,
  notUserIds: string[],
): Promise<PurchaseOrderApprovalLevel> {
  const level = a.approvalLevel;
  const approverId = awaiting(a, waiting);
  if (!waiting || !level || !approverId) throw new Error("This is not waiting for approval");
  if (approverId !== userId) throw new Error(`Only the chosen level ${level} approver can act on this now`);
  if (notUserIds.includes(userId)) throw new Error("You cannot approve a payment you requested or receive");
  if (!(await userHasPermission(userId, APPROVE_PERM[level]))) {
    throw new Error(`You no longer have level ${level} approval permission`);
  }
  return level;
}

/** The PO's approvers, copied onto a stage / nota at submit. */
function approversOf(order: LeanOrder): PaymentApproval {
  if (!order.approver1Id || !order.approver2Id) {
    throw new Error(`${order.number} has no approvers to approve its payments`);
  }
  return {
    ...CLEAR_APPROVAL,
    approver1Id: order.approver1Id,
    approver2Id: order.approver2Id,
    approvalLevel: 1,
    approvedAt: null,
    approvedBy: null,
    approvedByName: "",
    rejectedAt: null,
    rejectedBy: null,
    rejectReason: "",
  };
}

/** Level 1 hands over to level 2; level 2 approves. */
async function approvalStep(level: PurchaseOrderApprovalLevel, userId: string): Promise<PaymentApproval> {
  const now = new Date();
  const by = new Types.ObjectId(userId);
  const name = await displayName(userId);
  return level === 1
    ? { approvalLevel: 2, approved1At: now, approved1By: by, approved1ByName: name }
    : { approvalLevel: null, approvedAt: now, approvedBy: by, approvedByName: name };
}

/** Posted realizations of a PO split by who paid: the vendor (invoice) or staff (reimbursed). */
async function postedRealizations(orderId: Types.ObjectId): Promise<LeanRealization[]> {
  return (await PurchaseRealizationRepo.model
    .find({ purchaseOrderId: orderId, status: "posted" })
    .lean()
    .exec()) as LeanRealization[];
}

/** The vendor's payable on a PO, and whether it is final (fully received or closed). */
async function payableOf(order: LeanOrder): Promise<{
  base: string;
  final: boolean;
  staffRealizedTotal: string;
  realizations: LeanRealization[];
}> {
  const realizations = await postedRealizations(order._id);
  const realized = sumRealized(
    realizations.flatMap((r) => r.lines.map((l) => ({ poLineId: String(l.poLineId), qty: l.qty }))),
  );
  const fullyReceived =
    order.closedPartial === true ||
    realizationStatus(order.lines.map((l) => ({ qty: l.qty, realized: realized.get(String(l._id)) }))) === "full";
  const staffRealizedTotal = sumAmounts(
    realizations.filter((r) => r.method === "staff").map((r) => ({ amount: r.total })),
  );
  const { base, final } = vendorPayable({
    estimatedTotal: estimatesOf(order).total,
    staffRealizedTotal,
    vendorRealizedTotal: sumAmounts(
      realizations.filter((r) => r.method === "vendor").map((r) => ({ amount: r.total })),
    ),
    fullyReceived,
  });
  return { base, final, staffRealizedTotal, realizations };
}

async function liveStages(orderId: Types.ObjectId, exceptId?: Types.ObjectId): Promise<LeanPayment[]> {
  const query: Record<string, unknown> = {
    kind: "vendor",
    purchaseOrderId: orderId,
    status: { $in: PURCHASE_PAYMENT_LIVE_STATUSES },
  };
  if (exceptId) query._id = { $ne: exceptId };
  return (await PurchasePaymentRepo.model.find(query).lean().exec()) as LeanPayment[];
}

/** A vendor stage checked against the PO; returns the fields to store. */
async function checkedVendorFields(input: SaveVendorPaymentInDto, exceptId?: Types.ObjectId) {
  const order = await requireOrder(input.purchaseOrderId);
  if (order.status !== "approved" && !(order.status === "cancelled" && order.closedPartial)) {
    throw new Error("Payments can only be made on an approved PO");
  }
  const { base, final, realizations } = await payableOf(order);
  const others = await liveStages(order._id, exceptId);
  const priced =
    input.stage === "pelunasan" || !input.basis
      ? "0"
      : priceStage({ basis: input.basis, rate: input.rate, amount: input.amount, base });
  const { amount } = checkVendorStage({
    stage: input.stage,
    amount: priced,
    base,
    final,
    others: others.map((o) => ({ stage: o.stage ?? "termin", amount: o.amount })),
  });
  const vendorReceipts = new Set(realizations.filter((r) => r.method === "vendor").map((r) => String(r._id)));
  for (const id of input.realizationIds) {
    if (!vendorReceipts.has(id)) throw new Error("A linked receipt is not a posted vendor receipt of this PO");
  }
  return {
    purchaseOrderId: order._id,
    vendorId: order.vendorId,
    stage: input.stage,
    basis: input.stage === "pelunasan" ? null : input.basis,
    rate: input.basis === "percent" ? input.rate : null,
    realizationIds: input.realizationIds.map((id) => new Types.ObjectId(id)),
    amount,
    dueDate: input.dueDate,
    notes: input.notes,
  };
}

/** Notas already held by another live reimbursement (a rejected nota is free again). */
async function heldNotaIds(exceptId?: Types.ObjectId): Promise<Set<string>> {
  const query: Record<string, unknown> = {
    kind: "reimburse",
    status: { $in: PURCHASE_PAYMENT_LIVE_STATUSES },
  };
  if (exceptId) query._id = { $ne: exceptId };
  const docs = (await PurchasePaymentRepo.model.find(query).select({ items: 1 }).lean().exec()) as LeanPayment[];
  return new Set(
    docs.flatMap((d) => d.items.filter((i) => i.status !== "rejected").map((i) => String(i.realizationId))),
  );
}

/** A reimbursement's notas checked: posted staff notas bought by the payee, not held elsewhere. */
async function checkedReimburseFields(input: SaveReimbursementInDto, exceptId?: Types.ObjectId) {
  const payeeName = await displayName(input.payeeUserId);
  const notas = (await PurchaseRealizationRepo.model
    .find({ _id: { $in: input.realizationIds.map((id) => new Types.ObjectId(id)) } })
    .lean()
    .exec()) as LeanRealization[];
  if (notas.length !== input.realizationIds.length) throw new Error("A nota was not found");
  const held = await heldNotaIds(exceptId);
  for (const n of notas) {
    if (n.status !== "posted") throw new Error(`${n.number} is not posted`);
    if (n.method !== "staff") throw new Error(`${n.number} was not bought by staff`);
    if (String(n.buyerUserId) !== input.payeeUserId) {
      throw new Error(`${n.number} was bought by ${n.buyerName || "someone else"}, not ${payeeName}`);
    }
    if (held.has(String(n._id))) throw new Error(`${n.number} is already in another reimbursement`);
  }
  const items: ReimburseItem[] = notas.map((n) => ({
    realizationId: n._id,
    purchaseOrderId: n.purchaseOrderId,
    amount: n.total,
    status: "pending",
  }));
  return {
    payeeUserId: new Types.ObjectId(input.payeeUserId),
    payeeName,
    items,
    amount: sumAmounts(items),
    dueDate: input.dueDate,
    notes: input.notes,
  };
}

export class PurchasePaymentService {
  async list(filter: {
    kind?: PurchasePaymentKindDto;
    status?: PurchasePaymentStatusDto;
    q?: string;
  }, actor?: PoActor): Promise<PurchasePaymentOutDto[]> {
    const query: Record<string, unknown> = {};
    if (filter.kind) query.kind = filter.kind;
    if (filter.status) query.status = filter.status;
    const q = filter.q?.trim();
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const pos = await PurchaseOrderRepo.model.find({ number: rx }).select({ _id: 1 }).lean().exec();
      query.$or = [{ number: rx }, { payeeName: rx }, { purchaseOrderId: { $in: pos.map((p) => p._id) } }];
    }
    const docs = (await PurchasePaymentRepo.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec()) as LeanPayment[];
    return this.out(docs, actor);
  }

  /** Vendor stages and reimbursement notas waiting on this user's signature. */
  async approvals(actor: PoActor): Promise<PurchasePaymentOutDto[]> {
    const me = new Types.ObjectId(actor.userId);
    const docs = (await PurchasePaymentRepo.model
      .find({
        status: "pending_approval",
        $or: [
          { kind: "vendor", approvalLevel: 1, approver1Id: me },
          { kind: "vendor", approvalLevel: 2, approver2Id: me },
          { items: { $elemMatch: { status: "pending", approvalLevel: 1, approver1Id: me } } },
          { items: { $elemMatch: { status: "pending", approvalLevel: 2, approver2Id: me } } },
        ],
      })
      .sort({ submittedAt: 1 })
      .lean()
      .exec()) as LeanPayment[];
    return this.out(docs, actor);
  }

  async get(id: string, actor?: PoActor): Promise<PurchasePaymentOutDto> {
    const [out] = await this.out([await requirePayment(id)], actor);
    return out!;
  }

  async forOrder(orderId: string, actor?: PoActor): Promise<PurchaseOrderPaymentsOutDto> {
    if (!Types.ObjectId.isValid(orderId)) throw new Error("Invalid PO id");
    const order = await requireOrder(orderId);
    const { base, final, staffRealizedTotal } = await payableOf(order);
    const docs = (await PurchasePaymentRepo.model
      .find({ kind: "vendor", purchaseOrderId: order._id })
      .sort({ createdAt: 1 })
      .lean()
      .exec()) as LeanPayment[];
    const live = docs.filter((d) => PURCHASE_PAYMENT_LIVE_STATUSES.includes(d.status));
    const scheduled = sumAmounts(live);
    return {
      purchaseOrderId: orderId,
      payable: base,
      final,
      scheduledTotal: scheduled,
      paidTotal: sumAmounts(live.filter((d) => d.status === "paid")),
      remaining: Decimal.max(new Decimal(base).minus(scheduled), 0).toFixed(0),
      staffRealizedTotal,
      payments: await this.out(docs, actor),
    };
  }

  /** Approved (or closed-partial) POs that still have unscheduled vendor payable. */
  async listPayable(q?: string): Promise<PayablePurchaseOrderOutDto[]> {
    const docs = (await PurchaseOrderRepo.model
      .find({
        $or: [{ status: "approved" }, { status: "cancelled", closedPartial: true }],
      })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec()) as LeanOrder[];
    const vendors = await VendorRepo.model
      .find({ _id: { $in: [...new Set(docs.map((d) => String(d.vendorId)))].map((id) => new Types.ObjectId(id)) } })
      .select({ name: 1 })
      .lean()
      .exec();
    const vendorName = new Map(vendors.map((v) => [String(v._id), v.name as string]));
    const liveByOrder = new Map<string, LeanPayment[]>();
    const liveDocs = (await PurchasePaymentRepo.model
      .find({
        kind: "vendor",
        purchaseOrderId: { $in: docs.map((d) => d._id) },
        status: { $in: PURCHASE_PAYMENT_LIVE_STATUSES },
      })
      .lean()
      .exec()) as LeanPayment[];
    for (const p of liveDocs) {
      if (!p.purchaseOrderId) continue;
      const key = String(p.purchaseOrderId);
      const list = liveByOrder.get(key) ?? [];
      list.push(p);
      liveByOrder.set(key, list);
    }
    const rows: PayablePurchaseOrderOutDto[] = [];
    for (const order of docs) {
      const { base, final } = await payableOf(order);
      const live = liveByOrder.get(String(order._id)) ?? [];
      const scheduled = sumAmounts(live);
      const remaining = Decimal.max(new Decimal(base).minus(scheduled), 0).toFixed(0);
      if (new Decimal(remaining).lte(0)) continue;
      rows.push({
        id: String(order._id),
        number: order.number,
        vendorName: vendorName.get(String(order.vendorId)) ?? "Unknown vendor",
        payable: base,
        remaining,
        final,
      });
    }
    const needle = q?.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.number, r.vendorName].some((v) => v.toLowerCase().includes(needle)),
    );
  }

  /** Posted staff notas of a buyer that are not in a live reimbursement yet. */
  async reimbursable(payeeUserId: string, exceptId?: string): Promise<ReimbursableNotaOutDto[]> {
    if (!Types.ObjectId.isValid(payeeUserId)) throw new Error("Invalid user id");
    const held = await heldNotaIds(exceptId && Types.ObjectId.isValid(exceptId) ? new Types.ObjectId(exceptId) : undefined);
    const notas = (await PurchaseRealizationRepo.model
      .find({ status: "posted", method: "staff", buyerUserId: new Types.ObjectId(payeeUserId) })
      .sort({ purchaseDate: 1 })
      .lean()
      .exec()) as LeanRealization[];
    const free = notas.filter((n) => !held.has(String(n._id)));
    const poNumbers = await this.poNumbers(free.map((n) => n.purchaseOrderId));
    return free.map((n) => ({
      realizationId: String(n._id),
      number: n.number,
      purchaseOrderId: String(n.purchaseOrderId),
      purchaseOrderNumber: poNumbers.get(String(n.purchaseOrderId)) ?? "—",
      purchaseDate: n.purchaseDate,
      place: n.place ?? "",
      total: n.total,
    }));
  }

  async createVendor(input: SaveVendorPaymentInDto, actor: PoActor): Promise<PurchasePaymentOutDto> {
    const created = await withTx(async () => {
      const fields = await checkedVendorFields(input);
      return PurchasePaymentRepo.create({
        ...fields,
        number: await allocateNumber(),
        kind: "vendor",
        status: "draft",
        payeeName: "",
        items: [],
        reference: "",
        proofs: [],
        createdBy: new Types.ObjectId(actor.userId),
      });
    });
    return this.get(String(created._id), actor);
  }

  async updateVendor(id: string, input: SaveVendorPaymentInDto, actor: PoActor): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    if (doc.kind !== "vendor") throw new Error("This is not a vendor payment");
    assertOwner(doc, actor);
    assertEditable(doc);
    if (String(doc.purchaseOrderId) !== input.purchaseOrderId) {
      throw new Error("A payment cannot move to another PO");
    }
    await withTx(async () => {
      const fields = await checkedVendorFields(input, doc._id);
      const updated = await PurchasePaymentRepo.findOneAndUpdate(
        { _id: doc._id, status: doc.status },
        { $set: { ...fields, ...CLEAR_APPROVAL, status: "draft" } },
      );
      if (!updated) throw new Error("Payment changed meanwhile; reload it");
    });
    return this.get(id, actor);
  }

  async createReimbursement(input: SaveReimbursementInDto, actor: PoActor): Promise<PurchasePaymentOutDto> {
    const created = await withTx(async () => {
      const fields = await checkedReimburseFields(input);
      return PurchasePaymentRepo.create({
        ...fields,
        number: await allocateNumber(),
        kind: "reimburse",
        status: "draft",
        realizationIds: [],
        reference: "",
        proofs: [],
        createdBy: new Types.ObjectId(actor.userId),
      });
    });
    return this.get(String(created._id), actor);
  }

  async updateReimbursement(
    id: string,
    input: SaveReimbursementInDto,
    actor: PoActor,
  ): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    if (doc.kind !== "reimburse") throw new Error("This is not a reimbursement");
    assertOwner(doc, actor);
    if (doc.status !== "draft") throw new Error("Only a draft reimbursement can be changed");
    await withTx(async () => {
      const fields = await checkedReimburseFields(input, doc._id);
      const updated = await PurchasePaymentRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        { $set: fields },
      );
      if (!updated) throw new Error("Reimbursement is no longer a draft");
    });
    return this.get(id, actor);
  }

  async remove(id: string, actor: PoActor): Promise<void> {
    const doc = await requirePayment(id);
    assertOwner(doc, actor);
    if (doc.status !== "draft") throw new Error("Only a draft can be deleted; cancel it instead");
    const removed = await PurchasePaymentRepo.deleteOne({ _id: doc._id, status: "draft" });
    if (!removed) throw new Error("Payment not found");
  }

  /** Send for approval: a vendor stage to its PO's approvers, each nota to its own PO's. */
  async submit(id: string, actor: PoActor): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    assertOwner(doc, actor);
    if (doc.status !== "draft") throw new Error("Only a draft can be sent for approval");
    const base = { status: "pending_approval", submittedAt: new Date(), submittedBy: new Types.ObjectId(actor.userId) };
    await withTx(async () => {
      if (doc.kind === "vendor") {
        await checkedVendorFields(
          {
            purchaseOrderId: String(doc.purchaseOrderId),
            stage: doc.stage ?? "termin",
            basis: doc.basis ?? null,
            rate: doc.rate ?? null,
            amount: doc.amount,
            dueDate: doc.dueDate ?? null,
            notes: doc.notes,
            realizationIds: doc.realizationIds.map(String),
          },
          doc._id,
        );
        const order = await requireOrder(doc.purchaseOrderId!);
        const updated = await PurchasePaymentRepo.findOneAndUpdate(
          { _id: doc._id, status: "draft" },
          { $set: { ...base, ...approversOf(order) } },
        );
        if (!updated) throw new Error("Payment is no longer a draft");
        return;
      }
      const fields = await checkedReimburseFields(
        {
          payeeUserId: String(doc.payeeUserId),
          realizationIds: doc.items.map((i) => String(i.realizationId)),
          dueDate: doc.dueDate ?? null,
          notes: doc.notes,
        },
        doc._id,
      );
      const orders = new Map<string, LeanOrder>();
      for (const item of fields.items) {
        const key = String(item.purchaseOrderId);
        if (!orders.has(key)) orders.set(key, await requireOrder(item.purchaseOrderId));
      }
      const items = fields.items.map((i) => ({ ...i, ...approversOf(orders.get(String(i.purchaseOrderId))!) }));
      const updated = await PurchasePaymentRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        { $set: { ...base, items, amount: sumAmounts(items) } },
      );
      if (!updated) throw new Error("Reimbursement is no longer a draft");
    });
    await notifyPaymentEvent({ kind: "submitted", paymentId: id, actorUserId: actor.userId });
    return this.get(id, actor);
  }

  async approve(id: string, actor: PoActor): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    if (doc.kind !== "vendor") throw new Error("Approve each nota of a reimbursement");
    const level = await assertApprover(doc, doc.status === "pending_approval", actor.userId, [String(doc.createdBy)]);
    const step = await approvalStep(level, actor.userId);
    const updated = await PurchasePaymentRepo.findOneAndUpdate(
      { _id: doc._id, status: "pending_approval", approvalLevel: level },
      { $set: { ...step, ...(level === 2 ? { status: "approved" } : {}) } },
    );
    if (!updated) throw new Error("Payment changed meanwhile; reload it");
    await notifyPaymentEvent({ kind: "approved_step", paymentId: id, actorUserId: actor.userId });
    return this.get(id, actor);
  }

  async reject(id: string, reason: string, actor: PoActor): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    if (doc.kind !== "vendor") throw new Error("Reject each nota of a reimbursement");
    const level = await assertApprover(doc, doc.status === "pending_approval", actor.userId, [String(doc.createdBy)]);
    const updated = await PurchasePaymentRepo.findOneAndUpdate(
      { _id: doc._id, status: "pending_approval", approvalLevel: level },
      {
        $set: {
          ...CLEAR_APPROVAL,
          status: "rejected",
          rejectedAt: new Date(),
          rejectedBy: new Types.ObjectId(actor.userId),
          rejectReason: reason,
        },
      },
    );
    if (!updated) throw new Error("Payment changed meanwhile; reload it");
    await notifyPaymentEvent({ kind: "rejected", paymentId: id, actorUserId: actor.userId });
    return this.get(id, actor);
  }

  /** One nota of a reimbursement: level 1 → level 2 by its own PO's approvers. */
  async decideItem(
    id: string,
    itemId: string,
    decision: { approve: true } | { approve: false; reason: string },
    actor: PoActor,
  ): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    if (doc.kind !== "reimburse") throw new Error("This is not a reimbursement");
    const item = doc.items.find((i) => String(i._id) === itemId);
    if (!item) throw new Error("Nota not found in this reimbursement");
    const level = await assertApprover(
      item,
      doc.status === "pending_approval" && item.status === "pending",
      actor.userId,
      [String(doc.createdBy), String(doc.payeeUserId)],
    );
    const patch: Partial<ReimburseItem> = decision.approve
      ? { ...(await approvalStep(level, actor.userId)), ...(level === 2 ? { status: "approved" as const } : {}) }
      : {
          ...CLEAR_APPROVAL,
          status: "rejected",
          rejectedAt: new Date(),
          rejectedBy: new Types.ObjectId(actor.userId),
          rejectReason: decision.reason,
        };
    const items = doc.items.map((i) => (String(i._id) === itemId ? { ...i, ...patch } : i));
    const outcome = reimbursementOutcome(items);
    const updated = await PurchasePaymentRepo.findOneAndUpdate(
      {
        _id: doc._id,
        status: "pending_approval",
        items: { $elemMatch: { _id: item._id, status: "pending", approvalLevel: level } },
      },
      { $set: { items, status: outcome.status, amount: outcome.amount } },
    );
    if (!updated) throw new Error("Reimbursement changed meanwhile; reload it");
    await notifyPaymentEvent({
      kind: decision.approve ? "approved_step" : "rejected",
      paymentId: id,
      actorUserId: actor.userId,
      itemId,
    });
    return this.get(id, actor);
  }

  async cancel(id: string, reason: string, actor: PoActor): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    assertOwner(doc, actor);
    if (doc.status === "paid") throw new Error("A paid payment cannot be cancelled");
    if (doc.status === "cancelled") throw new Error("This payment is already cancelled");
    if (doc.status === "draft") throw new Error("Delete a draft instead");
    const updated = await PurchasePaymentRepo.findOneAndUpdate(
      { _id: doc._id, status: doc.status },
      {
        $set: {
          status: "cancelled",
          approvalLevel: null,
          cancelledAt: new Date(),
          cancelledBy: new Types.ObjectId(actor.userId),
          cancelReason: reason,
        },
      },
    );
    if (!updated) throw new Error("Payment changed meanwhile; reload it");
    return this.get(id, actor);
  }

  async addProofs(id: string, files: Express.Multer.File[], actor: PoActor): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    if (doc.status !== "approved") throw new Error("Proof is added to an approved payment, when paying it");
    if (files.length === 0) throw new Error("Choose at least one file");
    if (doc.proofs.length + files.length > PROOF_MAX) throw new Error(`At most ${PROOF_MAX} files per payment`);
    for (const f of files) {
      if (!PROOF_TYPES.test(f.mimetype)) {
        throw new Error(`${f.originalname}: use a photo (JPG, PNG, WEBP, HEIC) or a PDF`);
      }
      if (f.size > PROOF_MAX_BYTES) throw new Error(`${f.originalname} is larger than 15 MB`);
    }
    const uploaded: PurchasePaymentInterface["proofs"] = [];
    try {
      for (const f of files) {
        const stored = await uploadFile(PURCHASING_BUCKET, {
          buffer: f.buffer,
          filename: f.originalname,
          contentType: f.mimetype,
          metadata: { paymentId: id },
        });
        uploaded.push({
          gridFsId: stored.id,
          originalFilename: f.originalname,
          contentType: f.mimetype,
          sizeBytes: f.size,
          uploadedBy: new Types.ObjectId(actor.userId),
          uploadedAt: new Date(),
        });
      }
      const updated = await PurchasePaymentRepo.findOneAndUpdate(
        { _id: doc._id, status: "approved" },
        { $push: { proofs: { $each: uploaded } } },
      );
      if (!updated) throw new Error("Payment is no longer waiting to be paid");
    } catch (error) {
      for (const p of uploaded) await deleteFileIfExists(PURCHASING_BUCKET, p.gridFsId);
      throw error;
    }
    return this.get(id, actor);
  }

  async removeProof(id: string, proofId: string, actor: PoActor): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    if (doc.status !== "approved") throw new Error("Proof of a paid payment cannot be removed");
    const proof = doc.proofs.find((p) => String(p._id) === proofId);
    if (!proof) throw new Error("File not found");
    await PurchasePaymentRepo.findOneAndUpdate(
      { _id: doc._id, status: "approved" },
      { $pull: { proofs: { _id: proof._id } } },
    );
    await deleteFileIfExists(PURCHASING_BUCKET, proof.gridFsId).catch((error: unknown) =>
      logger.warn(
        error instanceof Error ? error.message : String(error),
        "modules/purchasing/purchasePayment.service.ts",
        "removeProof",
      ),
    );
    return this.get(id, actor);
  }

  async openProof(id: string, proofId: string) {
    const doc = await requirePayment(id);
    const proof = doc.proofs.find((p) => String(p._id) === proofId);
    if (!proof) throw new Error("File not found");
    if (!(await findFile(PURCHASING_BUCKET, proof.gridFsId))) throw new Error("File not found");
    return {
      stream: openDownload(PURCHASING_BUCKET, proof.gridFsId),
      filename: proof.originalFilename,
      contentType: proof.contentType,
    };
  }

  /** Finance: the money went out, with proof. Final. */
  async pay(id: string, input: PayPurchasePaymentInDto, actor: PoActor): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    if (doc.status !== "approved") throw new Error("Only an approved payment can be paid");
    if (doc.proofs.length === 0) throw new Error("Add the transfer slip or receipt before marking it paid");
    if (input.paidDate > jakartaYmdString()) throw new Error("paidDate cannot be in the future");
    const updated = await PurchasePaymentRepo.findOneAndUpdate(
      { _id: doc._id, status: "approved" },
      {
        $set: {
          status: "paid",
          paidAt: new Date(),
          paidBy: new Types.ObjectId(actor.userId),
          paidDate: input.paidDate,
          method: input.method,
          reference: input.reference,
        },
      },
    );
    if (!updated) throw new Error("Payment changed meanwhile; reload it");
    await notifyPaymentEvent({ kind: "paid", paymentId: id, actorUserId: actor.userId });
    return this.get(id, actor);
  }

  private async poNumbers(ids: Array<Types.ObjectId | null | undefined>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean).map(String))];
    if (unique.length === 0) return new Map();
    const pos = await PurchaseOrderRepo.model
      .find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
      .select({ number: 1 })
      .lean()
      .exec();
    return new Map(pos.map((p) => [String(p._id), p.number]));
  }

  /** As DTOs; with `actor`, also what that viewer may do (owner actions, their approval). */
  private async out(docs: LeanPayment[], actor?: PoActor): Promise<PurchasePaymentOutDto[]> {
    if (docs.length === 0) return [];
    const realizationIds = docs.flatMap((d) => [...d.realizationIds, ...d.items.map((i) => i.realizationId)]);
    const [poNumbers, vendors, realizations] = await Promise.all([
      this.poNumbers(docs.flatMap((d) => [d.purchaseOrderId, ...d.items.map((i) => i.purchaseOrderId)])),
      VendorRepo.model
        .find({ _id: { $in: docs.map((d) => d.vendorId).filter(Boolean) } })
        .select({ name: 1 })
        .lean()
        .exec(),
      PurchaseRealizationRepo.model
        .find({ _id: { $in: realizationIds } })
        .select({ number: 1, purchaseDate: 1, place: 1, total: 1 })
        .lean()
        .exec(),
    ]);
    const vendorName = new Map(vendors.map((v) => [String(v._id), v.name]));
    const notaById = new Map(realizations.map((r) => [String(r._id), r]));
    const approvalUsers = (a: PaymentApproval) => [a.approver1Id, a.approver2Id, a.approved1By, a.approvedBy, a.rejectedBy];
    const names = await userEmailsById(
      docs
        .flatMap((d) => [
          d.createdBy,
          d.paidBy,
          d.cancelledBy,
          ...approvalUsers(d),
          ...d.items.flatMap(approvalUsers),
        ])
        .filter(Boolean)
        .map(String),
    );
    const ref = (oid: Types.ObjectId | null | undefined): ProjectRabUserRefOutDto | null =>
      oid ? { id: String(oid), name: names.get(String(oid)) ?? String(oid) } : null;
    const approvalOut = (a: PaymentApproval, waiting: boolean): PaymentApprovalOutDto => ({
      viewerCanApprove: actor !== undefined && awaiting(a, waiting) === actor.userId,
      approver1: ref(a.approver1Id),
      approver2: ref(a.approver2Id),
      approvalLevel: waiting ? (a.approvalLevel ?? null) : null,
      awaitingUserId: awaiting(a, waiting),
      approved1By: ref(a.approved1By),
      approved1At: iso(a.approved1At),
      approvedBy: ref(a.approvedBy),
      approvedAt: iso(a.approvedAt),
      rejectedBy: ref(a.rejectedBy),
      rejectedAt: iso(a.rejectedAt),
      rejectReason: a.rejectReason ?? "",
    });
    return docs.map((d) => {
      const pending = d.status === "pending_approval";
      return {
        ...approvalOut(d, pending && d.kind === "vendor"),
        viewerIsOwner: actor !== undefined && (actor.superAdmin || String(d.createdBy) === actor.userId),
        id: String(d._id),
        number: d.number,
        kind: d.kind,
        status: d.status,
        purchaseOrderId: d.purchaseOrderId ? String(d.purchaseOrderId) : null,
        purchaseOrderNumber: d.purchaseOrderId ? (poNumbers.get(String(d.purchaseOrderId)) ?? null) : null,
        vendorName: d.vendorId ? (vendorName.get(String(d.vendorId)) ?? null) : null,
        stage: d.stage ?? null,
        basis: d.basis ?? null,
        rate: d.rate ?? null,
        realizations: d.realizationIds.map((rid) => {
          const r = notaById.get(String(rid));
          return { id: String(rid), number: r?.number ?? "—", purchaseDate: r?.purchaseDate ?? "", total: r?.total ?? "0" };
        }),
        payeeUserId: d.payeeUserId ? String(d.payeeUserId) : null,
        payeeName: d.payeeName ?? "",
        items: d.items.map((i) => {
          const r = notaById.get(String(i.realizationId));
          return {
            ...approvalOut(i, pending && i.status === "pending"),
            id: String(i._id),
            realizationId: String(i.realizationId),
            realizationNumber: r?.number ?? "—",
            purchaseOrderId: String(i.purchaseOrderId),
            purchaseOrderNumber: poNumbers.get(String(i.purchaseOrderId)) ?? "—",
            purchaseDate: r?.purchaseDate ?? "",
            place: r?.place ?? "",
            amount: i.amount,
            status: i.status,
          };
        }),
        amount: d.amount,
        dueDate: d.dueDate ?? null,
        notes: d.notes ?? "",
        createdBy: ref(d.createdBy),
        createdAt: iso(d.createdAt),
        submittedAt: iso(d.submittedAt),
        paidAt: iso(d.paidAt),
        paidBy: ref(d.paidBy),
        paidDate: d.paidDate ?? null,
        method: d.method ?? null,
        reference: d.reference ?? "",
        proofs: d.proofs.map((p) => ({
          id: String(p._id),
          originalFilename: p.originalFilename,
          contentType: p.contentType,
          sizeBytes: p.sizeBytes,
          uploadedAt: p.uploadedAt.toISOString(),
        })),
        cancelledAt: iso(d.cancelledAt),
        cancelledBy: ref(d.cancelledBy),
        cancelReason: d.cancelReason ?? "",
      };
    });
  }
}

export const purchasePaymentService = new PurchasePaymentService();

/** Realization void guard: a reimbursed nota, or a vendor receipt under a settled PO, must stay. */
export async function assertRealizationNotPaid(realization: {
  _id: Types.ObjectId;
  purchaseOrderId: Types.ObjectId;
  method: string;
}): Promise<void> {
  if (realization.method === "staff") {
    const held = await PurchasePaymentRepo.model
      .findOne({
        kind: "reimburse",
        status: { $in: PURCHASE_PAYMENT_LIVE_STATUSES },
        items: { $elemMatch: { realizationId: realization._id, status: { $ne: "rejected" } } },
      })
      .select({ number: 1 })
      .lean()
      .exec();
    if (held) throw new Error(`This nota is in reimbursement ${held.number}: cancel it there first`);
    return;
  }
  const settled = await PurchasePaymentRepo.model
    .findOne({
      kind: "vendor",
      purchaseOrderId: realization.purchaseOrderId,
      stage: "pelunasan",
      status: { $in: PURCHASE_PAYMENT_LIVE_STATUSES },
    })
    .select({ number: 1 })
    .lean()
    .exec();
  if (settled) throw new Error(`The PO is settled by pelunasan ${settled.number}: cancel it before voiding a receipt`);
}
