import Decimal from "decimal.js";
import { Types } from "mongoose";
import type {
  ProjectRabLabourExecutor,
  ProjectRabLine,
} from "../../models/projectRab.model";
import {
  ProductionOrderRepo,
  type ProductionOrderInterface,
} from "../../models/productionOrder.model";
import { ProductionReportRepo } from "../../models/productionReport.model";
import { formatDecimal } from "../../utils/decimal";
import { loadItemMeta } from "../itemMaster";
import {
  getProjectRab,
  isLabourLine,
  labourExecutor,
  labourRole,
  type StageLine,
  stagesOf,
} from "../project";
import { allocatedQty, assertProcessChange, assertStageReport, assertStageVoid, stageRoom } from "./production.planner";

/**
 * SPK per RAB labour line: the item's labour lines (stages + install) and
 * what each line has finished, shared by reports and vendor handovers.
 */

/** One RAB labour line of a shop drawing item. */
export type LabourLineState = StageLine & {
  labourItemId: string;
  labourUomId: string;
  name: string;
  executor: ProjectRabLabourExecutor;
  totalQty: string;
};

type OrderLineRef = Pick<
  ProductionOrderInterface,
  "shopDrawingItemId" | "labourItemId" | "labourUomId"
>;

type Id = Types.ObjectId | string;

/** The SPK's RAB line key: `${shopDrawingItemId}:${labourItemId}:${labourUomId}`. */
export function orderLineKey(o: { shopDrawingItemId: Id; labourItemId: Id; labourUomId: Id }): string {
  return `${String(o.shopDrawingItemId)}:${String(o.labourItemId)}:${String(o.labourUomId)}`;
}

/** Item id → its labour lines (making stages, then install steps), from RAB lines. */
export async function labourLinesByItem(
  rabLines: ProjectRabLine[],
): Promise<Map<string, LabourLineState[]>> {
  const lines = rabLines.filter((l) => isLabourLine(l) && l.shopDrawingItemId !== undefined);
  const { items } = await loadItemMeta(lines.map((l) => String(l.materialItemId)));
  const out = new Map<string, LabourLineState[]>();
  for (const l of lines) {
    const itemId = String(l.shopDrawingItemId);
    const meta = items.get(String(l.materialItemId));
    const list = out.get(itemId) ?? [];
    list.push({
      key: l.key,
      labourItemId: String(l.materialItemId),
      labourUomId: String(l.itemUomId),
      name: meta?.name?.trim() || meta?.code || "Labour",
      role: labourRole(l),
      executor: labourExecutor(l),
      sequence: l.sequence ?? null,
      weightPercent: l.weightPercent ?? null,
      totalQty: l.totalQty,
    });
    out.set(itemId, list);
  }
  for (const [itemId, list] of out) {
    out.set(itemId, [...stagesOf(list, "making"), ...stagesOf(list, "install")]);
  }
  return out;
}

/** Item id → its RAB labour lines, from the committed RAB (not an open change). */
export async function projectLabourLines(
  projectId: string,
): Promise<Map<string, LabourLineState[]>> {
  const rab = await getProjectRab(projectId);
  return labourLinesByItem(rab?.lines ?? []);
}

/**
 * RAB commit check on items already in production: lines with live SPKs
 * keep role, executor and their place as materials stage, and the new stage
 * order never puts a stage ahead of what feeds it.
 */
export async function assertProcessKept(
  projectId: string,
  before: ProjectRabLine[],
  after: ProjectRabLine[],
  removedItemIds: string[],
): Promise<void> {
  const orders = (await ProductionOrderRepo.model
    .find({ projectId: new Types.ObjectId(projectId), status: { $ne: "cancelled" } })
    .select({ shopDrawingItemId: 1, labourItemId: 1, labourUomId: 1 })
    .lean()
    .exec()) as Array<OrderLineRef & { _id: Types.ObjectId }>;
  if (orders.length === 0) return;
  const liveKeys = new Set(orders.map(orderLineKey));
  const itemIds = [...new Set(orders.map((o) => String(o.shopDrawingItemId)))].filter(
    (id) => !removedItemIds.includes(id),
  );
  const [beforeBy, afterBy, done] = await Promise.all([
    labourLinesByItem(before),
    labourLinesByItem(after),
    doneByLineForItems(itemIds.map((id) => new Types.ObjectId(id))),
  ]);
  for (const itemId of itemIds) {
    assertProcessChange({
      before: beforeBy.get(itemId) ?? [],
      after: afterBy.get(itemId) ?? [],
      liveKeys,
      doneByLine: done,
    });
  }
}

export async function itemLabourLines(
  projectId: string,
  itemId: string,
): Promise<LabourLineState[]> {
  return (await projectLabourLines(projectId)).get(itemId) ?? [];
}

/** Line key → Σ live reports over the item's SPKs. */
export async function doneByLineForItems(
  itemIds: Types.ObjectId[],
): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map();
  const orders = (await ProductionOrderRepo.model
    .find({ shopDrawingItemId: { $in: itemIds } })
    .select({ shopDrawingItemId: 1, labourItemId: 1, labourUomId: 1 })
    .lean()
    .exec()) as Array<OrderLineRef & { _id: Types.ObjectId }>;
  if (orders.length === 0) return new Map();
  const keyByOrder = new Map(orders.map((o) => [String(o._id), orderLineKey(o)]));
  const reports = await ProductionReportRepo.model
    .find({ productionOrderId: { $in: orders.map((o) => o._id) }, isVoided: false })
    .select({ productionOrderId: 1, qtyDone: 1 })
    .lean()
    .exec();
  const sums = new Map<string, Decimal>();
  for (const r of reports) {
    const key = keyByOrder.get(String(r.productionOrderId));
    if (!key) continue;
    sums.set(key, (sums.get(key) ?? new Decimal(0)).plus(r.qtyDone));
  }
  return new Map([...sums].map(([k, v]) => [k, formatDecimal(v)]));
}

/** The most any one labour line's live SPKs hold on an item (each is capped by makeQty). */
export async function heldQtyOnItem(itemId: Types.ObjectId): Promise<Decimal> {
  const orders = (await ProductionOrderRepo.model
    .find({ shopDrawingItemId: itemId, status: { $ne: "cancelled" } })
    .select({ shopDrawingItemId: 1, labourItemId: 1, labourUomId: 1, status: 1, qty: 1 })
    .lean()
    .exec()) as Array<
    OrderLineRef & { _id: Types.ObjectId; status: ProductionOrderInterface["status"]; qty: string }
  >;
  if (orders.length === 0) return new Decimal(0);
  const reports = await ProductionReportRepo.model
    .find({ productionOrderId: { $in: orders.map((o) => o._id) }, isVoided: false })
    .select({ productionOrderId: 1, qtyDone: 1 })
    .lean()
    .exec();
  const done = new Map<string, string>();
  for (const r of reports) {
    const key = String(r.productionOrderId);
    done.set(key, formatDecimal(new Decimal(done.get(key) ?? "0").plus(r.qtyDone)));
  }
  let max = new Decimal(0);
  for (const key of new Set(orders.map(orderLineKey))) {
    const rows = orders
      .filter((o) => orderLineKey(o) === key)
      .map((o) => ({ id: String(o._id), status: o.status, qty: o.qty }));
    max = Decimal.max(max, allocatedQty(rows, done));
  }
  return max;
}

/** Where a line's report room comes from, for messages and hints. */
export function roomSourceLabel(lines: LabourLineState[], key: string): string | null {
  const line = lines.find((l) => l.key === key);
  if (!line) return null;
  const stages = stagesOf(lines, line.role);
  const idx = stages.findIndex((s) => s.key === key);
  if (idx > 0) return stages[idx - 1]!.name;
  return line.role === "install" ? "Fully made" : null;
}

type StageOrder = OrderLineRef & { projectId: Types.ObjectId; qty: string };

/** Refuses a report / handover of `qtyDone` past the SPK qty or what the previous stage passed on. */
export async function assertOrderReportRoom(
  order: StageOrder,
  qtyDone: string,
  orderDone: string,
): Promise<void> {
  const lines = await itemLabourLines(String(order.projectId), String(order.shopDrawingItemId));
  const done = await doneByLineForItems([order.shopDrawingItemId]);
  const key = orderLineKey(order);
  assertStageReport({
    qtyDone,
    orderQty: order.qty,
    orderDone,
    room: stageRoom(lines, done, key),
    fromLabel: roomSourceLabel(lines, key) ?? "the previous stage",
  });
}

/** Refuses voiding `qty` on the SPK when a later stage (or install) already used it. */
export async function assertOrderVoidRoom(order: StageOrder, qty: string): Promise<void> {
  const lines = await itemLabourLines(String(order.projectId), String(order.shopDrawingItemId));
  const done = await doneByLineForItems([order.shopDrawingItemId]);
  assertStageVoid(lines, done, orderLineKey(order), qty);
}
