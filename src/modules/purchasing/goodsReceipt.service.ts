import Decimal from "decimal.js";
import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import type {
  CreateGoodsReceiptInDto,
  GoodsReceiptOutDto,
  GoodsReceiptStatusDto,
  GoodsReceiptSummaryOutDto,
  ReceiptPlanOutDto,
  ReceiptQueueRowOutDto,
} from "../../dto/purchasing.dto";
import {
  GoodsReceiptRepo,
  type GoodsReceiptInterface,
} from "../../models/goodsReceipt/goodsReceipt.model";
import { PurchaseOrderRepo } from "../../models/purchaseOrder/purchaseOrder.model";
import { PurchasingSeqCounterModel } from "../../models/seqCounter/seqCounter.model";
import { UserModel } from "../../models/user/user.model";
import { userEmailsById } from "../../utils/shared";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { projectNumberParts } from "../project/projectNumber";
import { checkReceiptLines, type ReceiptPoLineRef } from "./goodsReceipt.planner";
import { receivedByPoLine } from "./goodsReceiptLines";
import { purchaseOrderService, type PoActor } from "./purchaseOrder.service";
import { realizationStatus, remainingToRealize } from "./purchaseRealization.planner";

type LeanReceipt = GoodsReceiptInterface & { _id: Types.ObjectId };

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function allocateNumber(): Promise<string> {
  const parts = projectNumberParts();
  const scopeKey = `bpb:${parts.scopeKey}`;
  const counter = await PurchasingSeqCounterModel.findOneAndUpdate(
    { scopeKey },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey } },
    { upsert: true, new: true },
  ).exec();
  if (!counter || counter.nextSeq < 1) throw new Error("Failed to allocate receipt number");
  return `BPB/${parts.roman}/${parts.year}/${String(counter.nextSeq).padStart(4, "0")}`;
}

async function requireReceipt(id: string): Promise<LeanReceipt> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid receipt id");
  const doc = (await GoodsReceiptRepo.model.findById(id).lean().exec()) as LeanReceipt | null;
  if (!doc) throw new Error("Receipt not found");
  return doc;
}

export class GoodsReceiptService {
  /** Approved POs whose goods have not all arrived, oldest approval first. */
  async queue(): Promise<ReceiptQueueRowOutDto[]> {
    const orders = await PurchaseOrderRepo.model
      .find({ status: "approved" })
      .sort({ approvedAt: 1 })
      .limit(500)
      .lean()
      .exec();
    if (orders.length === 0) return [];
    const ids = orders.map((o) => String(o._id));
    const [received, summaries] = await Promise.all([
      receivedByPoLine(ids),
      purchaseOrderService.list({ ids }),
    ]);
    const summaryById = new Map(summaries.map((s) => [s.id, s]));
    const rows: ReceiptQueueRowOutDto[] = [];
    for (const o of orders) {
      const status = realizationStatus(
        o.lines.map((l) => ({ qty: l.qty, realized: received.get(String(l._id)) })),
      );
      const summary = summaryById.get(String(o._id));
      if (status === "full" || !summary) continue;
      rows.push({ ...summary, receiptStatus: status });
    }
    return rows;
  }

  /** PO lines with what is still expected. */
  async plan(orderId: string): Promise<ReceiptPlanOutDto> {
    const order = await purchaseOrderService.get(orderId);
    if (order.status !== "approved") throw new Error("Goods can only be received on an approved PO");
    const received = await receivedByPoLine([orderId]);
    return {
      purchaseOrderId: order.id,
      poNumber: order.number,
      vendorName: order.vendorName,
      requestId: order.requestId,
      requestNumber: order.requestNumber,
      projectNumber: order.projectNumber,
      projectName: order.projectName,
      expectedDate: order.expectedDate,
      lines: order.lines.map((l) => {
        const done = received.get(l.id) ?? new Decimal(0);
        return {
          poLineId: l.id,
          materialCode: l.materialCode,
          materialName: l.materialName,
          uomSymbol: l.uomSymbol,
          orderedQty: l.qty,
          receivedQty: formatDecimal(done),
          remainingQty: formatDecimal(remainingToRealize(l.qty, done)),
        };
      }),
    };
  }

  async list(filter: {
    status?: GoodsReceiptStatusDto;
    purchaseOrderId?: string;
    q?: string;
  }): Promise<GoodsReceiptSummaryOutDto[]> {
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    if (filter.purchaseOrderId) query.purchaseOrderId = new Types.ObjectId(filter.purchaseOrderId);
    const docs = (await GoodsReceiptRepo.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec()) as LeanReceipt[];
    const rows = await this.summaries(docs);
    const q = filter.q?.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.poNumber, r.vendorName, r.requestNumber, r.projectNumber, r.deliveryNoteNumber, r.receivedByName].some(
        (v) => v.toLowerCase().includes(q),
      ),
    );
  }

  async get(id: string): Promise<GoodsReceiptOutDto> {
    const doc = await requireReceipt(id);
    const [summary] = await this.summaries([doc]);
    const order = await purchaseOrderService.get(String(doc.purchaseOrderId));
    const poLine = new Map(order.lines.map((l) => [l.id, l]));
    const names = await userEmailsById([doc.voidedBy].filter(Boolean).map(String));
    const ref = (oid: Types.ObjectId | null | undefined): ProjectRabUserRefOutDto | null =>
      oid ? { id: String(oid), name: names.get(String(oid)) ?? String(oid) } : null;
    return {
      ...summary!,
      notes: doc.notes ?? "",
      lines: doc.lines.map((l) => {
        const po = poLine.get(String(l.poLineId));
        return {
          id: String(l._id),
          poLineId: String(l.poLineId),
          materialCode: po?.materialCode ?? "—",
          materialName: po?.materialName ?? "Unknown",
          uomSymbol: po?.uomSymbol ?? "—",
          orderedQty: po?.qty ?? "0",
          qty: l.qty,
          note: l.note ?? "",
        };
      }),
      voidedAt: iso(doc.voidedAt),
      voidedBy: ref(doc.voidedBy),
      voidReason: doc.voidReason ?? "",
    };
  }

  async create(input: CreateGoodsReceiptInDto, actor: PoActor): Promise<GoodsReceiptOutDto> {
    const raw = await PurchaseOrderRepo.model.findById(input.purchaseOrderId).lean().exec();
    if (!raw) throw new Error("PO not found");
    if (raw.status !== "approved") throw new Error("Goods can only be received on an approved PO");
    const order = await purchaseOrderService.get(input.purchaseOrderId);
    let receivedByName = "";
    if (input.receivedByUserId) {
      const user = await UserModel.findById(input.receivedByUserId)
        .select({ fullName: 1, email: 1 })
        .lean()
        .exec();
      if (!user) throw new Error("User not found");
      receivedByName = user.fullName?.trim() || user.email || "";
    }
    const requestLineOf = new Map(raw.lines.map((l) => [String(l._id), l.requestLineId]));
    const created = await withTx(async () => {
      const lines = checkReceiptLines({
        lines: input.lines,
        poLines: new Map<string, ReceiptPoLineRef>(
          order.lines.map((l) => [l.id, { poLineId: l.id, label: l.materialName, qty: l.qty }]),
        ),
        receivedBefore: await receivedByPoLine([input.purchaseOrderId]),
      });
      return GoodsReceiptRepo.create({
        number: await allocateNumber(),
        purchaseOrderId: raw._id,
        requestId: raw.requestId,
        projectId: raw.lines[0]!.projectId,
        productionOrderId: raw.lines[0]!.productionOrderId ?? null,
        status: "posted",
        receivedDate: input.receivedDate,
        receivedByUserId: input.receivedByUserId ? new Types.ObjectId(input.receivedByUserId) : null,
        receivedByName,
        deliveryNoteNumber: input.deliveryNoteNumber,
        notes: input.notes,
        lines: lines.map((l) => ({
          poLineId: new Types.ObjectId(l.poLineId),
          requestLineId: requestLineOf.get(l.poLineId)!,
          qty: l.qty,
          note: l.note,
        })),
        createdBy: new Types.ObjectId(actor.userId),
      });
    });
    return this.get(String(created._id));
  }

  async void(id: string, reason: string, actor: PoActor): Promise<GoodsReceiptOutDto> {
    const doc = await requireReceipt(id);
    if (doc.status !== "posted") throw new Error("This receipt is already voided");
    const updated = await GoodsReceiptRepo.findOneAndUpdate(
      { _id: doc._id, status: "posted" },
      {
        $set: {
          status: "voided",
          voidedAt: new Date(),
          voidedBy: new Types.ObjectId(actor.userId),
          voidReason: reason,
        },
      },
    );
    if (!updated) throw new Error("Failed to void receipt");
    return this.get(id);
  }

  private async summaries(docs: LeanReceipt[]): Promise<GoodsReceiptSummaryOutDto[]> {
    if (docs.length === 0) return [];
    const ids = [...new Set(docs.map((d) => String(d.purchaseOrderId)))];
    const [summaries, names] = await Promise.all([
      purchaseOrderService.list({ ids }),
      userEmailsById(docs.flatMap((d) => (d.createdBy ? [String(d.createdBy)] : []))),
    ]);
    const poById = new Map(summaries.map((s) => [s.id, s]));
    return docs.map((d) => {
      const po = poById.get(String(d.purchaseOrderId));
      const createdBy = d.createdBy ? String(d.createdBy) : null;
      return {
        id: String(d._id),
        number: d.number,
        status: d.status,
        purchaseOrderId: String(d.purchaseOrderId),
        poNumber: po?.number ?? "—",
        vendorName: po?.vendorName ?? "—",
        requestNumber: po?.requestNumber ?? "—",
        projectNumber: po?.projectNumber ?? "—",
        projectName: po?.projectName ?? "Unknown project",
        receivedDate: d.receivedDate,
        receivedByName: d.receivedByName ?? "",
        deliveryNoteNumber: d.deliveryNoteNumber ?? "",
        lineCount: d.lines.length,
        createdBy: createdBy ? { id: createdBy, name: names.get(createdBy) ?? createdBy } : null,
        createdAt: iso(d.createdAt),
      };
    });
  }
}

export const goodsReceiptService = new GoodsReceiptService();
