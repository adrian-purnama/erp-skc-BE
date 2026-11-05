import Decimal from "decimal.js";
import type {
  ProductionItemProgressStatusDto,
  ProductionReadinessCheckOutDto,
  ProductionReadinessItemOutDto,
} from "../../dto/production.dto";
import type { ProductionHandoverCheck } from "../../models/productionHandover.model";
import type { ProductionOrderStatus } from "../../models/productionOrder.model";
import type { ShopDrawingMakeType } from "../../models/projectShopDrawingItem.model";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import {
  collectSourceLines,
  rabLineKey,
  roundRabQty,
  type BoqLike,
  type RabUomPlan,
} from "../project/projectRab.planner";

/** Pure rules for releasing a project and sizing SPKs (no DB). */

export type ReadinessItemInput = {
  itemId: string;
  code: string;
  name: string;
  label: string;
  makeType: ShopDrawingMakeType;
  hasShopDrawing: boolean;
  hasBoq: boolean;
  makeQty: string | null;
  hasProductionFile: boolean;
  /** The item's RAB labour lines (making stages and install). */
  labour: StageLine[];
};

/** Outsource items: File Produksi is optional (it can still be uploaded). */
export function needsProductionFile(makeType: ShopDrawingMakeType): boolean {
  return makeType !== "outsource";
}

/** Outsource items need no BOQ: their make qty sits on the item. */
export function needsBoq(makeType: ShopDrawingMakeType): boolean {
  return makeType !== "outsource";
}

export type ReadinessInput = {
  wonQuotation: { revision: number; quotationNumber: string } | null;
  rabStatus: "none" | "draft" | "locked";
  rabChangeOpen: boolean;
  items: ReadinessItemInput[];
};

export type ReadinessResult = {
  ready: boolean;
  checks: ProductionReadinessCheckOutDto[];
  items: ProductionReadinessItemOutDto[];
  readyCount: number;
};

function positive(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    return new Decimal(raw).gt(0);
  } catch {
    return false;
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function evaluateReadiness(input: ReadinessInput): ReadinessResult {
  const items = input.items.map((i): ProductionReadinessItemOutDto => {
    const boqRequired = needsBoq(i.makeType);
    // Outsource: the item's own qty stands in for the BOQ.
    const boq = (i.hasBoq || !boqRequired) && positive(i.makeQty);
    const productionFileRequired = needsProductionFile(i.makeType);
    // Info only: the process is set up in Production and checked per SPK.
    const labour = processReadiness(i.labour);
    return {
      itemId: i.itemId,
      code: i.code,
      name: i.name,
      label: i.label,
      makeType: i.makeType,
      shopDrawing: i.hasShopDrawing,
      boq,
      boqRequired,
      makeQty: i.makeQty,
      productionFile: i.hasProductionFile,
      productionFileRequired,
      labour: labour.ok,
      labourDetail: labour.detail,
      ready:
        i.hasShopDrawing &&
        boq &&
        (i.hasProductionFile || !productionFileRequired),
    };
  });
  const readyCount = items.filter((i) => i.ready).length;

  const quotationOk = input.wonQuotation !== null;
  const rabOk = input.rabStatus === "locked" && !input.rabChangeOpen;
  const itemsOk = items.length > 0 && readyCount === items.length;

  const checks: ProductionReadinessCheckOutDto[] = [
    {
      key: "quotation",
      label: "Quotation won",
      ok: quotationOk,
      detail: input.wonQuotation
        ? `${input.wonQuotation.quotationNumber} (R${input.wonQuotation.revision})`
        : "Mark the accepted quotation revision as won",
    },
    {
      key: "rab",
      label: "RAB locked",
      ok: rabOk,
      detail:
        input.rabStatus !== "locked"
          ? "Lock the RAB"
          : input.rabChangeOpen
            ? "Commit or discard the open RAB change"
            : "Locked",
    },
    {
      key: "items",
      label: "Shop drawing items ready",
      ok: itemsOk,
      detail:
        items.length === 0
          ? "Add shop drawing items"
          : `${readyCount} of ${plural(items.length, "item")} have shop drawing, BOQ (outsource: qty), File Produksi (optional on outsource)`,
    },
  ];

  return {
    ready: quotationOk && rabOk && itemsOk,
    checks,
    items,
    readyCount,
  };
}

export type OrderQtyRow = {
  id: string;
  status: ProductionOrderStatus;
  qty: string;
};

/**
 * Qty an item's SPKs hold against makeQty. Cancelled SPKs hold nothing; a
 * completed SPK holds only what it finished, so a short close frees the rest.
 */
export function allocatedQty(
  orders: OrderQtyRow[],
  doneByOrder: Map<string, string>,
  exceptOrderId?: string,
): Decimal {
  let total = new Decimal(0);
  for (const o of orders) {
    if (o.id === exceptOrderId) continue;
    if (o.status === "cancelled") continue;
    if (o.status === "completed") {
      total = total.plus(doneByOrder.get(o.id) ?? "0");
    } else {
      total = total.plus(o.qty);
    }
  }
  return total;
}

/** Largest qty one SPK may take: makeQty minus what other SPKs hold. */
export function maxOrderQty(
  makeQty: string,
  orders: OrderQtyRow[],
  doneByOrder: Map<string, string>,
  exceptOrderId?: string,
): Decimal {
  const free = new Decimal(makeQty).minus(
    allocatedQty(orders, doneByOrder, exceptOrderId),
  );
  return free.isNeg() ? new Decimal(0) : free;
}

export function assertOrderQty(qty: string, max: Decimal): void {
  const q = new Decimal(qty);
  if (q.lte(0)) throw new Error("qty must be greater than 0");
  if (q.gt(max)) {
    throw new Error(
      `qty ${formatDecimal(q)} is more than the ${formatDecimal(max)} still free for this item`,
    );
  }
}

/** A report may not push the SPK past its qty. */
export function assertReportQty(
  qtyDone: string,
  orderQty: string,
  alreadyDone: string,
): void {
  const q = new Decimal(qtyDone);
  if (q.lte(0)) throw new Error("qtyDone must be greater than 0");
  const left = new Decimal(orderQty).minus(alreadyDone);
  if (q.gt(left)) {
    throw new Error(
      `qtyDone ${formatDecimal(q)} is more than the ${formatDecimal(left.isNeg() ? new Decimal(0) : left)} left on this SPK`,
    );
  }
}

/** Checklist a new handover starts with; it can be edited per handover. */
export const DEFAULT_HANDOVER_CHECKLIST: readonly string[] = [
  "Matches the shop drawing",
  "Dimensions as specified",
  "Finishing as specified",
  "No defects or damage",
  "Complete (parts, accessories)",
];

/** A handover can be posted once every row is checked and each "not OK" row says why. */
export function assertHandoverChecklist(checklist: ProductionHandoverCheck[]): void {
  if (checklist.length === 0) throw new Error("Add at least one checklist row");
  const unchecked = checklist.filter((c) => c.result === null);
  if (unchecked.length > 0) {
    throw new Error(`Check every row first (still open: ${unchecked.map((c) => c.label).join(", ")})`);
  }
  const unexplained = checklist.filter((c) => c.result === "not_ok" && !c.note.trim());
  if (unexplained.length > 0) {
    throw new Error(`Add a note to each row marked not OK (${unexplained.map((c) => c.label).join(", ")})`);
  }
}

/**
 * Vendor fee qty that may be received so far: the SPK's fee in proportion to
 * the units handed over (capped at the SPK qty).
 */
export function feeReceivableQty(feeQty: string, spkQty: string, doneQty: string): Decimal {
  const spk = new Decimal(spkQty);
  if (spk.lte(0)) return new Decimal(0);
  const done = Decimal.min(new Decimal(doneQty), spk);
  return new Decimal(feeQty).times(done).div(spk);
}

/** Refuses a vendor fee received past what the handovers so far allow. */
export function assertFeeWithinHandover(input: {
  label: string;
  feeQty: string;
  spkQty: string;
  doneQty: string;
  /** Fee qty on live (draft / posted) realizations, this one included. */
  realizedQty: string;
}): void {
  const receivable = feeReceivableQty(input.feeQty, input.spkQty, input.doneQty);
  if (new Decimal(input.realizedQty).gt(receivable)) {
    throw new Error(
      `${input.label}: only ${formatDecimal(receivable)} of ${input.feeQty} can be received so far ` +
        `(${formatDecimal(Decimal.min(new Decimal(input.doneQty), new Decimal(input.spkQty)))} of ${input.spkQty} units handed over)`,
    );
  }
}

/** One SPK material that can be sent to the vendor: what is at our warehouse and not sent yet. */
export type DispatchableMaterial = { label: string; available: Decimal };

/**
 * Lines of a material dispatch: SPK materials only, once each, and no more
 * than is at our warehouse and not already sent (or on its way).
 */
export function checkDispatchLines(
  lines: Array<{ materialItemId: string; itemUomId: string; qty: string }>,
  allowed: Map<string, DispatchableMaterial>,
): Array<{ materialItemId: string; itemUomId: string; qty: string }> {
  const kept = lines.filter((l) => new Decimal(l.qty).gt(0));
  if (kept.length === 0) throw new Error("Add at least one material to send");
  const seen = new Set<string>();
  return kept.map((l) => {
    const key = `${l.materialItemId}:${l.itemUomId}`;
    const material = allowed.get(key);
    if (!material) throw new Error("A line is not material of this SPK");
    if (seen.has(key)) throw new Error(`${material.label} is listed twice`);
    seen.add(key);
    const qty = new Decimal(l.qty);
    if (qty.gt(material.available)) {
      throw new Error(
        `${material.label}: only ${formatDecimal(Decimal.max(material.available, 0))} is at our warehouse and not sent yet`,
      );
    }
    return { ...l, qty: formatDecimal(qty) };
  });
}

export type PlannedMaterial = {
  materialItemId: string;
  itemUomId: string;
  qtyPerUnit: string;
  /** qtyPerUnit × SPK qty, before rounding. */
  exactQty: string;
  /** What to request / issue: exactQty rounded by the RAB rule (cumulatively). */
  qty: string;
};

/** What this item's earlier SPKs already planned for one material×UOM. */
export type PriorMaterialIssue = { exactQty: string; qty: string };

type PlannedOptions = { plan?: RabUomPlan; prior?: Map<string, PriorMaterialIssue> };

/**
 * Per-unit materials scaled to the SPK qty. With a RAB UOM plan each line is
 * rounded like the RAB (step converted into this unit), cumulatively over the
 * item's SPKs: this SPK gets the rounded running total minus what earlier SPKs
 * got, so splits add up to the whole.
 */
export function scaleMaterials(
  rows: Array<{ materialItemId: string; itemUomId: string; qtyPerUnit: string }>,
  qty: string,
  options: PlannedOptions = {},
): PlannedMaterial[] {
  const q = new Decimal(qty);
  return rows.map((row) => {
    const key = rabLineKey(row.materialItemId, row.itemUomId);
    const exact = new Decimal(row.qtyPerUnit).times(q);
    const rule = options.plan?.get(key);
    let issue = exact;
    if (rule?.rounding) {
      // The rule's step is in the RAB target unit; factor = target units per this unit.
      const step = formatDecimal(new Decimal(rule.rounding.step).div(rule.factor));
      const prior = options.prior?.get(key);
      issue = roundRabQty(new Decimal(prior?.exactQty ?? 0).plus(exact), {
        ...rule.rounding,
        step,
      }).minus(prior?.qty ?? 0);
      if (issue.isNeg()) issue = new Decimal(0);
    }
    return {
      materialItemId: row.materialItemId,
      itemUomId: row.itemUomId,
      qtyPerUnit: row.qtyPerUnit,
      exactQty: formatDecimal(exact),
      qty: formatDecimal(issue),
    };
  });
}

/** BOQ lines summed per material×UOM, then scaled (and rounded) to the SPK qty. */
export function planMaterials(
  boq: BoqLike,
  qty: string,
  options: PlannedOptions = {},
): PlannedMaterial[] {
  const perUnit = new Map<string, { materialItemId: string; itemUomId: string; sum: Decimal }>();
  for (const line of collectSourceLines([{ ...boq, makeQty: "1" }])) {
    const key = rabLineKey(line.materialItemId, line.itemUomId);
    const row = perUnit.get(key) ?? {
      materialItemId: line.materialItemId,
      itemUomId: line.itemUomId,
      sum: new Decimal(0),
    };
    row.sum = row.sum.plus(line.qtyPerUnit);
    perUnit.set(key, row);
  }
  return scaleMaterials(
    [...perUnit.values()].map(({ sum, ...row }) => ({ ...row, qtyPerUnit: formatDecimal(sum) })),
    qty,
    options,
  );
}

/**
 * Outsource fee: the RAB labour lines costed to the item, spread over its
 * makeQty and scaled to the SPK qty. They become the SPK "materials", so the
 * vendor is engaged through the normal SPP → PO → realization flow.
 */
export function planFeeLines(
  labourLines: Array<{ materialItemId: string; itemUomId: string; totalQty: string }>,
  makeQty: string,
  qty: string,
): PlannedMaterial[] {
  const make = new Decimal(makeQty);
  if (make.lte(0)) return [];
  return labourLines.map((l) => {
    // total × qty / make (not perUnit × qty) so a full-qty SPK gets exactly the RAB qty.
    const exact = formatDecimal(new Decimal(l.totalQty).times(qty).div(make));
    return {
      materialItemId: l.materialItemId,
      itemUomId: l.itemUomId,
      qtyPerUnit: formatDecimal(new Decimal(l.totalQty).div(make)),
      exactQty: exact,
      qty: exact,
    };
  });
}

export function progressStatus(input: {
  makeQty: string;
  orderedQty: string;
  doneQty: string;
}): ProductionItemProgressStatusDto {
  const make = new Decimal(input.makeQty);
  const done = new Decimal(input.doneQty);
  const ordered = new Decimal(input.orderedQty);
  if (make.gt(0) && done.gte(make)) return "done";
  if (done.gt(0)) return "in_progress";
  if (ordered.gt(0)) return "partial";
  return "not_started";
}

export function percentOf(done: string, total: string): number {
  const t = new Decimal(total);
  if (t.lte(0)) return 0;
  const p = new Decimal(done).div(t).times(100);
  return Math.min(100, Math.max(0, Math.round(p.toNumber())));
}

/** One RAB labour line of an item, as the SPK stage rules see it. */
export type StageLine = {
  key: string;
  role: "making" | "install";
  sequence: number | null;
  weightPercent: number | null;
};

type StageRole = StageLine["role"];

/** One track's lines (making or install) in stage order, unsequenced last. */
export function stagesOf<T extends StageLine>(lines: T[], role: StageRole): T[] {
  return lines
    .filter((l) => l.role === role)
    .sort((a, b) => (a.sequence ?? 9999) - (b.sequence ?? 9999));
}

/** Making lines in stage order (unsequenced last). */
export function makingStages<T extends StageLine>(lines: T[]): T[] {
  return stagesOf(lines, "making");
}

const TRACK_LABEL: Record<StageRole, string> = { making: "Making", install: "Install" };

function assertTrack(stages: StageLine[], role: StageRole): void {
  const label = TRACK_LABEL[role];
  stages.forEach((s, i) => {
    if (s.sequence !== i + 1) {
      throw new Error(`${label} labour sequences must be 1, 2, 3… with no gaps`);
    }
    if (
      s.weightPercent === null ||
      !Number.isInteger(s.weightPercent) ||
      s.weightPercent < 1 ||
      s.weightPercent > 100
    ) {
      throw new Error(`Each ${label.toLowerCase()} labour weight must be an integer from 1 to 100`);
    }
  });
  const sum = stages.reduce((acc, s) => acc + (s.weightPercent ?? 0), 0);
  if (stages.length > 0 && sum !== 100) {
    throw new Error(`${label} labour weights must total 100% (currently ${sum}%)`);
  }
}

/**
 * The item's process is usable for SPKs: at least one making stage; each
 * track (making, and install if any) has sequences 1..n and weights totalling 100.
 */
export function assertLabourStages(lines: StageLine[]): void {
  const making = stagesOf(lines, "making");
  if (making.length === 0) {
    throw new Error("Set up this item's process: add at least one making stage");
  }
  assertTrack(making, "making");
  assertTrack(stagesOf(lines, "install"), "install");
}

/** Process status of an item, for the production panel. */
export function processReadiness(lines: StageLine[]): { ok: boolean; detail: string } {
  try {
    assertLabourStages(lines);
    const making = stagesOf(lines, "making").length;
    const install = stagesOf(lines, "install").length;
    return {
      ok: true,
      detail: `${plural(making, "stage")}${install > 0 ? ` + ${plural(install, "install step")}` : ""}`,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function doneOf(doneByLine: Map<string, string>, key: string): Decimal {
  return new Decimal(doneByLine.get(key) ?? "0");
}

function lastDone(lines: StageLine[], doneByLine: Map<string, string>, role: StageRole): string {
  const stages = stagesOf(lines, role);
  const last = stages[stages.length - 1];
  return last ? formatDecimal(doneOf(doneByLine, last.key)) : "0";
}

/** Pcs fully made: done on the last making stage. */
export function madeQty(lines: StageLine[], doneByLine: Map<string, string>): string {
  return lastDone(lines, doneByLine, "making");
}

/** Pcs fully installed: done on the last install stage. */
export function installedQty(lines: StageLine[], doneByLine: Map<string, string>): string {
  return lastDone(lines, doneByLine, "install");
}

/**
 * What feeds a line: the previous stage of its track; install stage 1 is
 * fed by pcs fully made. Null on making stage 1 (only SPK qty caps it).
 */
function sourceDone(
  lines: StageLine[],
  doneByLine: Map<string, string>,
  line: StageLine,
): Decimal | null {
  const stages = stagesOf(lines, line.role);
  const idx = stages.findIndex((s) => s.key === line.key);
  if (idx > 0) return doneOf(doneByLine, stages[idx - 1]!.key);
  if (line.role === "install") return new Decimal(madeQty(lines, doneByLine));
  return null;
}

/**
 * Item-wide qty a line may still report: what feeds it minus what it
 * already did. Null on the first making stage: only the SPK qty caps it.
 */
export function stageRoom(
  lines: StageLine[],
  doneByLine: Map<string, string>,
  key: string,
): Decimal | null {
  const line = lines.find((l) => l.key === key);
  if (!line) throw new Error("This SPK's labour line is no longer on the RAB");
  const source = sourceDone(lines, doneByLine, line);
  if (source === null) return null;
  const room = source.minus(doneOf(doneByLine, key));
  return room.isNeg() ? new Decimal(0) : room;
}

/**
 * Pcs an install line's SPKs may hold in all: what feeds it (fully made pcs
 * for install step 1, else the previous install step's done).
 */
export function installCapacity(
  lines: StageLine[],
  doneByLine: Map<string, string>,
  key: string,
): string {
  const line = lines.find((l) => l.key === key);
  if (!line) throw new Error("This SPK's labour line is no longer on the RAB");
  return formatDecimal(sourceDone(lines, doneByLine, line) ?? new Decimal(0));
}

/** A report (or handover) must fit the SPK qty and what the previous stage passed on. */
export function assertStageReport(input: {
  qtyDone: string;
  orderQty: string;
  orderDone: string;
  room: Decimal | null;
  fromLabel: string;
}): void {
  assertReportQty(input.qtyDone, input.orderQty, input.orderDone);
  if (input.room !== null && new Decimal(input.qtyDone).gt(input.room)) {
    throw new Error(
      `qtyDone ${formatDecimal(new Decimal(input.qtyDone))} is more than the ${formatDecimal(input.room)} ${input.fromLabel} has passed on`,
    );
  }
}

/** The line `line` feeds: the next stage of its track; after the last making stage, install step 1. */
function fedBy(lines: StageLine[], line: StageLine): StageLine | null {
  const stages = stagesOf(lines, line.role);
  const idx = stages.findIndex((s) => s.key === line.key);
  const next = stages[idx + 1];
  if (next) return next;
  if (line.role === "making") return stagesOf(lines, "install")[0] ?? null;
  return null;
}

/** Voiding `qty` on line `key` must not leave the stage it feeds ahead of it. */
export function assertStageVoid(
  lines: StageLine[],
  doneByLine: Map<string, string>,
  key: string,
  qty: string,
): void {
  const line = lines.find((l) => l.key === key);
  if (!line) return;
  const after = doneOf(doneByLine, key).minus(qty);
  const next = fedBy(lines, line);
  if (next && doneOf(doneByLine, next.key).gt(after)) {
    throw new Error(
      next.role === line.role
        ? "Cannot void: the next stage already reported more than this stage would have left"
        : "Cannot void: more pcs were already installed than would be left fully made",
    );
  }
}

/** A labour line as the process-change check sees it. */
export type ProcessLine = StageLine & {
  name: string;
  executor: "inhouse" | "vendor";
};

/**
 * A process edit on an item that may already be in production:
 * - lines with live SPKs keep their role and executor and are not removed
 * - making stage 1 with live SPKs stays stage 1 (it carries the BOQ materials)
 * - in the new order no stage has done more than what feeds it
 */
export function assertProcessChange(input: {
  before: ProcessLine[];
  after: ProcessLine[];
  /** Line keys with live (non-cancelled) SPKs. */
  liveKeys: Set<string>;
  doneByLine: Map<string, string>;
}): void {
  const afterByKey = new Map(input.after.map((l) => [l.key, l]));
  for (const b of input.before) {
    if (!input.liveKeys.has(b.key)) continue;
    const a = afterByKey.get(b.key);
    if (!a) throw new Error(`${b.name} has live SPKs: cancel them before removing the stage`);
    if (a.role !== b.role) throw new Error(`${b.name} has live SPKs: making / install can't change`);
    if (a.executor !== b.executor) {
      throw new Error(`${b.name} has live SPKs: inhouse / vendor can't change`);
    }
  }
  const firstBefore = makingStages(input.before)[0];
  if (firstBefore && input.liveKeys.has(firstBefore.key)) {
    if (makingStages(input.after)[0]?.key !== firstBefore.key) {
      throw new Error(
        `${firstBefore.name} has live SPKs and carries the materials: it must stay making stage 1`,
      );
    }
  }
  const nameOf = (key: string) => afterByKey.get(key)?.name ?? "A stage";
  assertStageOrderKept(input.after, input.doneByLine, nameOf);
}

/** In stage order, no line has done more than what feeds it. */
export function assertStageOrderKept(
  lines: StageLine[],
  doneByLine: Map<string, string>,
  nameOf: (key: string) => string,
): void {
  for (const line of lines) {
    const source = sourceDone(lines, doneByLine, line);
    if (source === null) continue;
    const done = doneOf(doneByLine, line.key);
    if (done.gt(source)) {
      const stages = stagesOf(lines, line.role);
      const idx = stages.findIndex((s) => s.key === line.key);
      const from = idx > 0 ? nameOf(stages[idx - 1]!.key) : "fully made";
      throw new Error(
        `${nameOf(line.key)} already did ${formatDecimal(done)}, more than the ${formatDecimal(source)} ${from} would pass on in this order`,
      );
    }
  }
}

/** Unrounded track %: Σ weight × min(stage done, makeQty) ÷ makeQty, clamped 0–100. */
export function trackPercentExact(
  makeQty: string,
  lines: StageLine[],
  doneByLine: Map<string, string>,
  role: StageRole,
): number {
  const make = new Decimal(makeQty);
  if (make.lte(0)) return 0;
  let sum = new Decimal(0);
  for (const s of stagesOf(lines, role)) {
    const done = Decimal.min(doneOf(doneByLine, s.key), make);
    sum = sum.plus(done.div(make).times(s.weightPercent ?? 0));
  }
  return Math.min(100, Math.max(0, sum.toNumber()));
}

function trackPercent(
  makeQty: string,
  lines: StageLine[],
  doneByLine: Map<string, string>,
  role: StageRole,
): number {
  return Math.round(trackPercentExact(makeQty, lines, doneByLine, role));
}

/** Item making %: Σ weight × min(stage done, makeQty) ÷ makeQty, 0–100. */
export function itemMakingPercent(
  makeQty: string,
  lines: StageLine[],
  doneByLine: Map<string, string>,
): number {
  return trackPercent(makeQty, lines, doneByLine, "making");
}

/** Item install %: the same over the install steps. */
export function itemInstallPercent(
  makeQty: string,
  lines: StageLine[],
  doneByLine: Map<string, string>,
): number {
  return trackPercent(makeQty, lines, doneByLine, "install");
}
