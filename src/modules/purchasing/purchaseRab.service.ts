import Decimal from "decimal.js";
import { Types } from "mongoose";
import type {
  PurchaseRabLineInDto,
  PurchaseRabLineOutDto,
  PurchaseRabOutDto,
  PurchaseRabStatusDto,
  PurchaseRabSummaryOutDto,
  PurchasingRabOptionOutDto,
  SavePurchaseRabInDto,
} from "../../dto/purchasing.dto";
import type { ProjectRabUserRefOutDto } from "../../dto/projectRab.dto";
import {
  PurchaseRabRepo,
  type PurchaseRabInterface,
  type PurchaseRabLine,
} from "../../models/purchaseRab.model";
import { PurchaseRequestRepo, type PurchaseRequestStatus } from "../../models/purchaseRequest.model";
import { PurchasingSeqCounterModel } from "../../models/seqCounter.model";
import { userEmailsById } from "../../utils/shared";
import { loadItemMeta } from "../itemMaster/itemMeta";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { projectNumberParts } from "../project/projectNumber";
import { lineAmount, sumOrdered } from "./purchaseOrder.planner";
import { liveOrderLines } from "./purchaseOrderLines";
import { assertUomsMatch } from "./purchasing.service";
import { checkRealizationCharges, priceStoredCharges } from "./purchaseRealization.planner";
import { materialKey } from "./purchasing.planner";

type LeanRab = PurchaseRabInterface & { _id: Types.ObjectId };

/** SPP statuses that still hold qty against their RAB. */
const LIVE_REQUEST_STATUSES: PurchaseRequestStatus[] = ["draft", "submitted"];

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

async function allocateRabNumber(): Promise<string> {
  const parts = projectNumberParts();
  const scopeKey = `prab:${parts.scopeKey}`;
  const counter = await PurchasingSeqCounterModel.findOneAndUpdate(
    { scopeKey },
    { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey } },
    { upsert: true, new: true },
  ).exec();
  if (!counter || counter.nextSeq < 1) throw new Error("Failed to allocate RAB number");
  return `RAB/${parts.roman}/${parts.year}/${String(counter.nextSeq).padStart(4, "0")}`;
}

export async function requirePurchaseRab(id: string): Promise<LeanRab> {
  if (!Types.ObjectId.isValid(id)) throw new Error("Invalid RAB id");
  const doc = (await PurchaseRabRepo.model.findById(id).lean().exec()) as LeanRab | null;
  if (!doc) throw new Error("RAB not found");
  return doc;
}

/** Unique material×UOM, qty above 0, units that belong to their material. */
async function checkLines(lines: PurchaseRabLineInDto[]): Promise<PurchaseRabLine[]> {
  await assertUomsMatch(lines);
  const meta = await loadItemMeta(lines.map((l) => l.materialItemId));
  const seen = new Set<string>();
  return lines.map((l) => {
    const key = materialKey(l);
    const name = meta.items.get(l.materialItemId)?.name ?? "Material";
    if (seen.has(key)) throw new Error(`${name} is listed twice`);
    seen.add(key);
    if (new Decimal(l.qty).lte(0)) throw new Error(`${name}: qty must be greater than 0`);
    return {
      key,
      materialItemId: new Types.ObjectId(l.materialItemId),
      itemUomId: new Types.ObjectId(l.itemUomId),
      qty: l.qty,
      unitPrice: l.unitPrice,
      note: l.note,
    };
  });
}

function rabTotal(lines: PurchaseRabLine[]): string {
  return lines.reduce((sum, l) => sum.plus(lineAmount(l.qty, l.unitPrice)), new Decimal(0)).toFixed(0);
}

export class PurchaseRabService {
  /** Locked RABs an SPP can be made for. */
  async requestable(): Promise<PurchasingRabOptionOutDto[]> {
    const docs = (await PurchaseRabRepo.model
      .find({ status: "locked" })
      .sort({ number: -1 })
      .lean()
      .exec()) as LeanRab[];
    const rows = await this.summaries(docs);
    return rows.map((r) => ({ id: r.id, number: r.number, title: r.title }));
  }

  async list(filter: { status?: PurchaseRabStatusDto; q?: string }): Promise<PurchaseRabSummaryOutDto[]> {
    const query: Record<string, unknown> = {};
    if (filter.status) query.status = filter.status;
    const docs = (await PurchaseRabRepo.model
      .find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec()) as LeanRab[];
    const rows = await this.summaries(docs);
    const q = filter.q?.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.number, r.title].some((v) => v.toLowerCase().includes(q)),
    );
  }

  async get(id: string): Promise<PurchaseRabOutDto> {
    const doc = await requirePurchaseRab(id);
    const [summary] = await this.summaries([doc]);
    const requests = await PurchaseRequestRepo.model
      .find({ purchaseRabId: doc._id })
      .select({ number: 1, status: 1, lines: 1 })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    const live = requests.filter((r) => LIVE_REQUEST_STATUSES.includes(r.status));
    const ordered = sumOrdered(await liveOrderLines(live.map((r) => r._id)));
    const requestedByKey = new Map<string, Decimal>();
    const orderedByKey = new Map<string, Decimal>();
    for (const r of live) {
      for (const l of r.lines) {
        if (l.source === "extra") continue;
        const key = materialKey({ materialItemId: String(l.materialItemId), itemUomId: String(l.itemUomId) });
        requestedByKey.set(key, (requestedByKey.get(key) ?? new Decimal(0)).plus(l.qty));
        orderedByKey.set(
          key,
          (orderedByKey.get(key) ?? new Decimal(0)).plus(ordered.get(String(l._id)) ?? 0),
        );
      }
    }
    const [{ items, uoms }, names] = await Promise.all([
      loadItemMeta(doc.lines.map((l) => String(l.materialItemId))),
      userEmailsById(doc.lockedBy ? [String(doc.lockedBy)] : []),
    ]);
    const ref = (oid: Types.ObjectId | null | undefined): ProjectRabUserRefOutDto | null =>
      oid ? { id: String(oid), name: names.get(String(oid)) ?? String(oid) } : null;
    const priced = priceStoredCharges(summary!.total, doc.charges ?? []);
    return {
      ...summary!,
      notes: doc.notes ?? "",
      charges: priced.charges,
      chargesTotal: priced.chargesTotal,
      grandTotal: priced.total,
      lines: doc.lines.map((l): PurchaseRabLineOutDto => {
        const itemId = String(l.materialItemId);
        const uomId = String(l.itemUomId);
        return {
          key: l.key,
          materialItemId: itemId,
          materialCode: items.get(itemId)?.code ?? "—",
          materialName: items.get(itemId)?.name ?? "Unknown",
          itemUomId: uomId,
          uomSymbol: uoms.get(uomId)?.symbol ?? "—",
          qty: l.qty,
          unitPrice: l.unitPrice,
          amount: lineAmount(l.qty, l.unitPrice).toFixed(0),
          note: l.note ?? "",
          requestedQty: formatDecimal(requestedByKey.get(l.key) ?? new Decimal(0)),
          orderedQty: formatDecimal(orderedByKey.get(l.key) ?? new Decimal(0)),
        };
      }),
      lockedBy: ref(doc.lockedBy),
      requests: requests.map((r) => ({ id: String(r._id), number: r.number, status: r.status })),
      canUnlock: doc.status === "locked" && live.length === 0,
    };
  }

  async create(input: SavePurchaseRabInDto, userId: string): Promise<PurchaseRabOutDto> {
    const lines = await checkLines(input.lines);
    const { charges } = checkRealizationCharges(rabTotal(lines), input.charges);
    const created = await PurchaseRabRepo.create({
      number: await allocateRabNumber(),
      title: input.title,
      status: "draft",
      notes: input.notes,
      lines,
      charges,
      createdBy: new Types.ObjectId(userId),
    });
    return this.get(String(created._id));
  }

  async update(id: string, input: SavePurchaseRabInDto): Promise<PurchaseRabOutDto> {
    const doc = await requirePurchaseRab(id);
    if (doc.status !== "draft") throw new Error("Only a draft RAB can be edited; unlock it first");
    const lines = await checkLines(input.lines);
    const { charges } = checkRealizationCharges(rabTotal(lines), input.charges);
    const updated = await PurchaseRabRepo.findOneAndUpdate(
      { _id: doc._id, status: "draft" },
      {
        $set: {
          title: input.title,
          notes: input.notes,
          lines,
          charges,
        },
      },
    );
    if (!updated) throw new Error("RAB is no longer a draft");
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const doc = await requirePurchaseRab(id);
    if (doc.status !== "draft") throw new Error("Only a draft RAB can be deleted");
    const used = await PurchaseRequestRepo.model.exists({ purchaseRabId: doc._id }).exec();
    if (used) throw new Error("SPPs were made for this RAB, so it cannot be deleted");
    const removed = await PurchaseRabRepo.deleteOne({ _id: doc._id, status: "draft" });
    if (!removed) throw new Error("RAB not found");
  }

  /** Locked RABs can be picked on an SPP. */
  async lock(id: string, userId: string): Promise<PurchaseRabOutDto> {
    const doc = await requirePurchaseRab(id);
    if (doc.status !== "draft") throw new Error("RAB is already locked");
    if (doc.lines.length === 0) throw new Error("Add at least one item before locking");
    const updated = await PurchaseRabRepo.findOneAndUpdate(
      { _id: doc._id, status: "draft" },
      { $set: { status: "locked", lockedAt: new Date(), lockedBy: new Types.ObjectId(userId) } },
    );
    if (!updated) throw new Error("RAB is no longer a draft");
    return this.get(id);
  }

  /** Back to draft, only while no live SPP is made for it. */
  async unlock(id: string): Promise<PurchaseRabOutDto> {
    const doc = await requirePurchaseRab(id);
    if (doc.status !== "locked") throw new Error("RAB is not locked");
    const live = await PurchaseRequestRepo.model
      .exists({ purchaseRabId: doc._id, status: { $in: LIVE_REQUEST_STATUSES } })
      .exec();
    if (live) throw new Error("Live SPPs use this RAB: cancel them before unlocking");
    const updated = await PurchaseRabRepo.findOneAndUpdate(
      { _id: doc._id, status: "locked" },
      { $set: { status: "draft", lockedAt: null, lockedBy: null } },
    );
    if (!updated) throw new Error("RAB is no longer locked");
    return this.get(id);
  }

  private async summaries(docs: LeanRab[]): Promise<PurchaseRabSummaryOutDto[]> {
    if (docs.length === 0) return [];
    const names = await userEmailsById(docs.flatMap((d) => (d.createdBy ? [String(d.createdBy)] : [])));
    return docs.map((d) => {
      const createdBy = d.createdBy ? String(d.createdBy) : null;
      return {
        id: String(d._id),
        number: d.number,
        title: d.title,
        status: d.status,
        lineCount: d.lines.length,
        total: rabTotal(d.lines),
        createdBy: createdBy ? { id: createdBy, name: names.get(createdBy) ?? createdBy } : null,
        createdAt: iso(d.createdAt),
        lockedAt: iso(d.lockedAt),
      };
    });
  }
}

export const purchaseRabService = new PurchaseRabService();
