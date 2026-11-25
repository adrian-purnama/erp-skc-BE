import Decimal from "decimal.js";
import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import { deleteFileIfExists, findFile, openDownload, uploadFile } from "../../core/gridfs";
import { logger } from "../../core/logger";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import type {
  PayablePurchaseOrderOutDto,
  PaymentApprovalOutDto,
  PaymentPayeeOutDto,
  PayPurchasePaymentInDto,
  PurchaseOrderPaymentsOutDto,
  PurchasePaymentKindDto,
  PurchasePaymentOutDto,
  PurchasePaymentStatusDto,
  SavePurchasePaymentInDto,
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
  type PurchasePaymentKind,
} from "../../models/purchasePayment.model";
import {
  PurchaseRealizationRepo,
  type PurchaseRealizationInterface,
} from "../../models/purchaseRealization.model";
import { PurchasingSeqCounterModel } from "../../models/seqCounter.model";
import { VendorInvoiceRepo, type VendorInvoiceInterface } from "../../models/vendorInvoice.model";
import { getUserRef, userEmailsById } from "../auth";
import { jakartaYmdString } from "../../utils/time";
import { numberingPeriod } from "../../utils/numbering";
import { APPROVE_PERM, PURCHASING_BUCKET, type PoActor } from "./purchaseOrder.service";
import { userHasPermission } from "../../core/permissions/resolve.service";
import { checkPaymentAmount, priceStage, sumAmounts } from "./purchasePayment.planner";
import { vendorMoney } from "./vendorMoney";
import { notifyPaymentEvent } from "./paymentNotify";
import { getVendorNames, getVendorRef } from "../vendor";

type LeanPayment = PurchasePaymentInterface & { _id: Types.ObjectId };
type LeanOrder = PurchaseOrderInterface & { _id: Types.ObjectId };
type LeanRealization = PurchaseRealizationInterface & { _id: Types.ObjectId };
type LeanInvoice = VendorInvoiceInterface & { _id: Types.ObjectId };

/** Someone a PO owes money to: its vendor, or a staff member for their posted NR. */
type Payee = {
  kind: PurchasePaymentKind;
  payeeUserId: string | null;
  name: string;
  owed: string;
  final: boolean;
  /** Reimburse: their NR, which a payment may name. */
  realizations: LeanRealization[];
  /** Vendor: the PO's posted invoices, which a payment may name. */
  invoices: LeanInvoice[];
};

function invoiceRef(i: LeanInvoice) {
  return {
    id: String(i._id),
    number: i.number,
    vendorInvoiceNumber: i.vendorInvoiceNumber ?? "",
    invoiceDate: i.invoiceDate,
    total: i.total,
  };
}

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
  const parts = numberingPeriod();
  const scopeKey = `pay:${parts.scopeKey}`;
  const counter = await PurchasingSeqCounterModel.findOneAndUpdate(
    { scopeKey },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey } },
    { upsert: true, returnDocument: "after" },
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
  const user = await getUserRef(userId);
  if (!user) throw new Error("User not found");
  return user.name;
}

async function vendorNameOf(vendorId: Types.ObjectId): Promise<string> {
  const vendor = await getVendorRef(vendorId);
  return vendor?.name ?? "Unknown vendor";
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

function assertPayableOrder(order: LeanOrder): void {
  if (order.status !== "approved" && !(order.status === "cancelled" && order.closedPartial)) {
    throw new Error("Payments can only be made on an approved PO");
  }
}

/** Who a level 1 → 2 approval waits on now. */
function awaiting(a: PaymentApproval, waiting: boolean): string | null {
  if (!waiting) return null;
  const id = a.approvalLevel === 1 ? a.approver1Id : a.approvalLevel === 2 ? a.approver2Id : null;
  return id ? String(id) : null;
}

/** The chosen approver of the level it waits on, still holding that permission, not the requester or payee. */
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

/** The PO's approvers, copied onto the payment at submit. */
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

/**
 * Everyone the PO owes: the vendor first (its GRs at invoice or PO price, plus
 * goods not yet received at the PO price; see `vendorMoney.ts`), then each
 * staff member with posted NR (their NR total). `exceptRealizationId`: as if
 * that GR / NR were voided.
 */
async function payeesOf(order: LeanOrder, exceptRealizationId?: Types.ObjectId): Promise<Payee[]> {
  const money = await vendorMoney(order, {
    exceptRealizationId: exceptRealizationId ? String(exceptRealizationId) : undefined,
  });
  const staffNotas = money.realizations.filter((r) => r.method === "staff" && r.buyerUserId);
  const invoices = (await VendorInvoiceRepo.model
    .find({ purchaseOrderId: order._id, status: "posted" })
    .sort({ invoiceDate: 1, createdAt: 1 })
    .lean()
    .exec()) as LeanInvoice[];
  const payees: Payee[] = [
    {
      kind: "vendor",
      payeeUserId: null,
      name: await vendorNameOf(order.vendorId),
      owed: money.vendorOwed,
      final: money.final,
      realizations: [],
      invoices,
    },
  ];
  const byBuyer = new Map<string, LeanRealization[]>();
  for (const n of staffNotas) {
    const key = String(n.buyerUserId);
    byBuyer.set(key, [...(byBuyer.get(key) ?? []), n]);
  }
  for (const [userId, notas] of byBuyer) {
    payees.push({
      kind: "reimburse",
      payeeUserId: userId,
      name: notas[notas.length - 1]!.buyerName || (await displayName(userId)),
      owed: sumAmounts(notas.map((n) => ({ amount: n.total }))),
      final: true,
      realizations: notas,
      invoices: [],
    });
  }
  return payees;
}

function samePayee(p: { kind: PurchasePaymentKind; payeeUserId?: Types.ObjectId | string | null }, payee: Payee) {
  return p.kind === payee.kind && (payee.kind === "vendor" || String(p.payeeUserId) === payee.payeeUserId);
}

async function livePayments(orderId: Types.ObjectId, exceptId?: Types.ObjectId): Promise<LeanPayment[]> {
  const query: Record<string, unknown> = {
    purchaseOrderId: orderId,
    status: { $in: PURCHASE_PAYMENT_LIVE_STATUSES },
  };
  if (exceptId) query._id = { $ne: exceptId };
  return (await PurchasePaymentRepo.model.find(query).lean().exec()) as LeanPayment[];
}

/** A payment checked against what its payee is owed on the PO; returns the fields to store. */
async function checkedFields(
  kind: PurchasePaymentKind,
  input: SavePurchasePaymentInDto,
  exceptId?: Types.ObjectId,
) {
  const order = await requireOrder(input.purchaseOrderId);
  assertPayableOrder(order);
  const payees = await payeesOf(order);
  const payee =
    kind === "vendor"
      ? payees[0]!
      : payees.find((p) => p.kind === "reimburse" && p.payeeUserId === input.payeeUserId);
  if (!payee) {
    const name = input.payeeUserId ? await displayName(input.payeeUserId) : "This person";
    throw new Error(`${name} has no posted Nota Realisasi on ${order.number} to be paid back for`);
  }
  const others = (await livePayments(order._id, exceptId)).filter((p) => samePayee(p, payee));
  const priced =
    input.stage === "full" || !input.basis
      ? "0"
      : priceStage({ basis: input.basis, rate: input.rate, amount: input.amount, base: payee.owed });
  const { amount } = checkPaymentAmount({ stage: input.stage, amount: priced, owed: payee.owed, others });
  const notas = new Set(payee.realizations.map((r) => String(r._id)));
  for (const id of input.realizationIds) {
    if (!notas.has(id)) throw new Error(`A linked document is not a posted NR of ${payee.name} on this PO`);
  }
  const invoices = new Set(payee.invoices.map((i) => String(i._id)));
  for (const id of input.invoiceIds) {
    if (!invoices.has(id)) throw new Error("A linked invoice is not a posted vendor invoice of this PO");
  }
  return {
    purchaseOrderId: order._id,
    vendorId: order.vendorId,
    payeeUserId: payee.payeeUserId ? new Types.ObjectId(payee.payeeUserId) : null,
    payeeName: payee.name,
    stage: input.stage,
    basis: input.stage === "full" ? null : input.basis,
    rate: input.basis === "percent" ? input.rate : null,
    realizationIds: input.realizationIds.map((id) => new Types.ObjectId(id)),
    invoiceIds: input.invoiceIds.map((id) => new Types.ObjectId(id)),
    amount,
    dueDate: input.dueDate,
    notes: input.notes,
  };
}

function inputOf(doc: LeanPayment): SavePurchasePaymentInDto {
  return {
    purchaseOrderId: String(doc.purchaseOrderId),
    payeeUserId: doc.payeeUserId ? String(doc.payeeUserId) : null,
    stage: doc.stage,
    basis: doc.basis ?? null,
    rate: doc.rate ?? null,
    amount: doc.amount,
    dueDate: doc.dueDate ?? null,
    notes: doc.notes,
    realizationIds: doc.realizationIds.map(String),
    invoiceIds: (doc.invoiceIds ?? []).map(String),
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

  /** Payments waiting on this user's signature. */
  async approvals(actor: PoActor): Promise<PurchasePaymentOutDto[]> {
    const me = new Types.ObjectId(actor.userId);
    const docs = (await PurchasePaymentRepo.model
      .find({
        status: "pending_approval",
        $or: [
          { approvalLevel: 1, approver1Id: me },
          { approvalLevel: 2, approver2Id: me },
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
    const payees = await payeesOf(order);
    const docs = (await PurchasePaymentRepo.model
      .find({ purchaseOrderId: order._id })
      .sort({ createdAt: 1 })
      .lean()
      .exec()) as LeanPayment[];
    const live = docs.filter((d) => PURCHASE_PAYMENT_LIVE_STATUSES.includes(d.status));
    // A payee with only cancelled history still shows if it once had payments.
    const payeesOut: PaymentPayeeOutDto[] = payees.map((p) => {
      const mine = live.filter((d) => samePayee(d, p));
      const scheduled = sumAmounts(mine);
      return {
        kind: p.kind,
        payeeUserId: p.payeeUserId,
        name: p.name,
        owed: p.owed,
        final: p.final,
        scheduledTotal: scheduled,
        paidTotal: sumAmounts(mine.filter((d) => d.status === "paid")),
        remaining: Decimal.max(new Decimal(p.owed).minus(scheduled), 0).toFixed(0),
        realizations: p.realizations.map((r) => ({
          id: String(r._id),
          number: r.number,
          purchaseDate: r.purchaseDate,
          total: r.total,
        })),
        invoices: p.invoices.map(invoiceRef),
      };
    });
    return {
      purchaseOrderId: orderId,
      purchaseOrderNumber: order.number,
      vendorName: payees[0]!.name,
      payees: payeesOut,
      owedTotal: sumAmounts(payeesOut.map((p) => ({ amount: p.owed }))),
      paidTotal: sumAmounts(payeesOut.map((p) => ({ amount: p.paidTotal }))),
      remaining: sumAmounts(payeesOut.map((p) => ({ amount: p.remaining }))),
      payments: await this.out(docs, actor),
    };
  }

  /** Approved (or closed-partial) POs where some payee still has an unscheduled amount. */
  async listPayable(q?: string): Promise<PayablePurchaseOrderOutDto[]> {
    const docs = (await PurchaseOrderRepo.model
      .find({
        $or: [{ status: "approved" }, { status: "cancelled", closedPartial: true }],
      })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec()) as LeanOrder[];
    const liveDocs = (await PurchasePaymentRepo.model
      .find({
        purchaseOrderId: { $in: docs.map((d) => d._id) },
        status: { $in: PURCHASE_PAYMENT_LIVE_STATUSES },
      })
      .lean()
      .exec()) as LeanPayment[];
    const liveByOrder = new Map<string, LeanPayment[]>();
    for (const p of liveDocs) {
      const key = String(p.purchaseOrderId);
      liveByOrder.set(key, [...(liveByOrder.get(key) ?? []), p]);
    }
    const rows: PayablePurchaseOrderOutDto[] = [];
    for (const order of docs) {
      const payees = await payeesOf(order);
      const live = liveByOrder.get(String(order._id)) ?? [];
      let remaining = new Decimal(0);
      for (const p of payees) {
        const left = new Decimal(p.owed).minus(sumAmounts(live.filter((d) => samePayee(d, p))));
        remaining = remaining.plus(Decimal.max(left, 0));
      }
      if (remaining.lte(0)) continue;
      rows.push({
        id: String(order._id),
        number: order.number,
        vendorName: payees[0]!.name,
        owed: sumAmounts(payees.map((p) => ({ amount: p.owed }))),
        remaining: remaining.toFixed(0),
      });
    }
    const needle = q?.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.number, r.vendorName].some((v) => v.toLowerCase().includes(needle)),
    );
  }

  async create(
    kind: PurchasePaymentKind,
    input: SavePurchasePaymentInDto,
    actor: PoActor,
  ): Promise<PurchasePaymentOutDto> {
    const created = await withTx(async () => {
      const fields = await checkedFields(kind, input);
      return PurchasePaymentRepo.create({
        ...fields,
        number: await allocateNumber(),
        kind,
        status: "draft",
        reference: "",
        proofs: [],
        createdBy: new Types.ObjectId(actor.userId),
      });
    });
    return this.get(String(created._id), actor);
  }

  async update(
    id: string,
    kind: PurchasePaymentKind,
    input: SavePurchasePaymentInDto,
    actor: PoActor,
  ): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    if (doc.kind !== kind) {
      throw new Error(kind === "vendor" ? "This is not a vendor payment" : "This is not a reimbursement");
    }
    assertOwner(doc, actor);
    assertEditable(doc);
    if (String(doc.purchaseOrderId) !== input.purchaseOrderId) {
      throw new Error("A payment cannot move to another PO");
    }
    await withTx(async () => {
      const fields = await checkedFields(kind, input, doc._id);
      const updated = await PurchasePaymentRepo.findOneAndUpdate(
        { _id: doc._id, status: doc.status },
        { $set: { ...fields, ...CLEAR_APPROVAL, status: "draft" } },
      );
      if (!updated) throw new Error("Payment changed meanwhile; reload it");
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

  /** Send for approval to the PO's level 1 → level 2 approvers. */
  async submit(id: string, actor: PoActor): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    assertOwner(doc, actor);
    if (doc.status !== "draft") throw new Error("Only a draft can be sent for approval");
    await withTx(async () => {
      const fields = await checkedFields(doc.kind, inputOf(doc), doc._id);
      const order = await requireOrder(doc.purchaseOrderId);
      const updated = await PurchasePaymentRepo.findOneAndUpdate(
        { _id: doc._id, status: "draft" },
        {
          $set: {
            ...fields,
            ...approversOf(order),
            status: "pending_approval",
            submittedAt: new Date(),
            submittedBy: new Types.ObjectId(actor.userId),
          },
        },
      );
      if (!updated) throw new Error("Payment is no longer a draft");
    });
    await notifyPaymentEvent({ kind: "submitted", paymentId: id, actorUserId: actor.userId });
    return this.get(id, actor);
  }

  async approve(id: string, actor: PoActor): Promise<PurchasePaymentOutDto> {
    const doc = await requirePayment(id);
    const level = await assertApprover(doc, doc.status === "pending_approval", actor.userId, notApprovers(doc));
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
    const level = await assertApprover(doc, doc.status === "pending_approval", actor.userId, notApprovers(doc));
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

  private async poNumbers(ids: Types.ObjectId[]): Promise<Map<string, string>> {
    // Payments from before the per-PO design have no PO.
    const unique = [...new Set(ids.map(String))].filter((id) => Types.ObjectId.isValid(id));
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
    const [poNumbers, vendorName, realizations, invoices] = await Promise.all([
      this.poNumbers(docs.map((d) => d.purchaseOrderId)),
      getVendorNames(docs.map((d) => d.vendorId)),
      PurchaseRealizationRepo.model
        .find({ _id: { $in: docs.flatMap((d) => d.realizationIds ?? []) } })
        .select({ number: 1, purchaseDate: 1, total: 1 })
        .lean()
        .exec(),
      VendorInvoiceRepo.model
        .find({ _id: { $in: docs.flatMap((d) => d.invoiceIds ?? []) } })
        .lean()
        .exec() as Promise<LeanInvoice[]>,
    ]);
    const invoiceById = new Map(invoices.map((i) => [String(i._id), i]));
    const realizationById = new Map(realizations.map((r) => [String(r._id), r]));
    const names = await userEmailsById(
      docs
        .flatMap((d) => [
          d.createdBy,
          d.paidBy,
          d.cancelledBy,
          d.approver1Id,
          d.approver2Id,
          d.approved1By,
          d.approvedBy,
          d.rejectedBy,
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
      const vendor = d.vendorId ? (vendorName.get(String(d.vendorId)) ?? null) : null;
      return {
        ...approvalOut(d, d.status === "pending_approval"),
        viewerIsOwner: actor !== undefined && (actor.superAdmin || String(d.createdBy) === actor.userId),
        id: String(d._id),
        number: d.number,
        kind: d.kind,
        status: d.status,
        purchaseOrderId: d.purchaseOrderId ? String(d.purchaseOrderId) : "",
        purchaseOrderNumber: poNumbers.get(String(d.purchaseOrderId)) ?? "—",
        vendorName: vendor,
        stage: d.stage ?? "partial",
        basis: d.basis ?? null,
        rate: d.rate ?? null,
        realizations: (d.realizationIds ?? []).map((rid) => {
          const r = realizationById.get(String(rid));
          return { id: String(rid), number: r?.number ?? "—", purchaseDate: r?.purchaseDate ?? "", total: r?.total ?? "0" };
        }),
        invoices: (d.invoiceIds ?? []).flatMap((iid) => {
          const i = invoiceById.get(String(iid));
          return i ? [invoiceRef(i)] : [];
        }),
        payeeUserId: d.payeeUserId ? String(d.payeeUserId) : null,
        payeeName: d.payeeName || (d.kind === "vendor" ? (vendor ?? "") : ""),
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
        proofs: (d.proofs ?? []).map((p) => ({
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

/** The requester and the staff member receiving the money cannot approve it. */
function notApprovers(doc: LeanPayment): string[] {
  return [doc.createdBy, doc.payeeUserId].filter(Boolean).map(String);
}

export const purchasePaymentService = new PurchasePaymentService();

/**
 * Realization void guard: a GR / NR named on a live payment must stay, and
 * voiding must not leave its payee (the vendor, or the NR's buyer) owed less
 * than is already scheduled to them.
 */
export async function assertRealizationNotPaid(realization: {
  _id: Types.ObjectId;
  purchaseOrderId: Types.ObjectId;
  method: string;
  buyerUserId?: Types.ObjectId | null;
}): Promise<void> {
  const live = await livePayments(realization.purchaseOrderId);
  const naming = live.find((p) => p.realizationIds.some((id) => String(id) === String(realization._id)));
  if (naming) throw new Error(`This document is named on payment ${naming.number}: cancel it there first`);
  const kind: PurchasePaymentKind = realization.method === "staff" ? "reimburse" : "vendor";
  const buyer = realization.buyerUserId ? String(realization.buyerUserId) : null;
  const scheduled = sumAmounts(
    live.filter((p) => p.kind === kind && (kind === "vendor" || String(p.payeeUserId) === buyer)),
  );
  if (new Decimal(scheduled).lte(0)) return;
  const payees = await payeesOf(await requireOrder(realization.purchaseOrderId), realization._id);
  const payee = payees.find((p) => p.kind === kind && (kind === "vendor" || p.payeeUserId === buyer));
  const owed = payee?.owed ?? "0";
  if (new Decimal(scheduled).gt(owed)) {
    throw new Error(
      `Rp ${scheduled} is already scheduled to ${payee?.name ?? "this buyer"} on this PO; after voiding only Rp ${owed} would be owed. Cancel a payment first`,
    );
  }
}
