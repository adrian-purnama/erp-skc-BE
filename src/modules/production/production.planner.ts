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
};

/** Outsource vendors work from the shop drawing; no File Produksi needed. */
export function needsProductionFile(makeType: ShopDrawingMakeType): boolean {
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
    const boq = i.hasBoq && positive(i.makeQty);
    const productionFileRequired = needsProductionFile(i.makeType);
    return {
      itemId: i.itemId,
      code: i.code,
      name: i.name,
      label: i.label,
      makeType: i.makeType,
      shopDrawing: i.hasShopDrawing,
      boq,
      makeQty: i.hasBoq ? i.makeQty : null,
      productionFile: i.hasProductionFile,
      productionFileRequired,
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
          : `${readyCount} of ${plural(items.length, "item")} have shop drawing, BOQ and File Produksi (outsource: shop drawing and BOQ qty)`,
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

/** Frozen / planned inhouse labour stage (sequence + weight). */
export type LabourStageRef = {
  sequence: number;
  weightPercent: number;
};

export type StageReportRow = {
  qtyDone: string;
  stageSequence?: number | null;
};

/** Inhouse release: ≥1 stage, sequences 1..n, weights sum to exactly 100. */
export function assertLabourStagesForRelease(
  stages: Array<{ sequence: number; weightPercent: number }>,
): void {
  if (stages.length === 0) {
    throw new Error(
      "Cannot release: add inhouse labour stages on this item's RAB (sequence + weight %) first",
    );
  }
  const sorted = [...stages].sort((a, b) => a.sequence - b.sequence);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]!;
    if (s.sequence !== i + 1) {
      throw new Error(
        "Cannot release: labour stage sequences must be 1, 2, 3… with no gaps",
      );
    }
    if (
      !Number.isInteger(s.weightPercent) ||
      s.weightPercent < 1 ||
      s.weightPercent > 100
    ) {
      throw new Error("Each labour stage weight must be an integer from 1 to 100");
    }
  }
  const sum = sorted.reduce((acc, s) => acc + s.weightPercent, 0);
  if (sum !== 100) {
    throw new Error(
      `Cannot release: labour stage weights must total 100% (currently ${sum}%)`,
    );
  }
}

/** Σ qtyDone per stage sequence (only rows with a stageSequence). */
export function qtyByStage(
  reports: StageReportRow[],
  stages: LabourStageRef[],
): Map<number, string> {
  const sums = new Map<number, Decimal>();
  for (const s of stages) sums.set(s.sequence, new Decimal(0));
  for (const r of reports) {
    if (r.stageSequence == null) continue;
    if (!sums.has(r.stageSequence)) continue;
    sums.set(r.stageSequence, sums.get(r.stageSequence)!.plus(r.qtyDone));
  }
  return new Map([...sums].map(([k, v]) => [k, formatDecimal(v)]));
}

/** Pcs that finished the last stage. */
export function finishedQty(
  stages: LabourStageRef[],
  byStage: Map<number, string>,
): string {
  if (stages.length === 0) return "0";
  const last = Math.max(...stages.map((s) => s.sequence));
  return byStage.get(last) ?? "0";
}

/** Σ (qtyAtStage / orderQty × weight), rounded 0–100. */
export function weightedProgressPercent(
  orderQty: string,
  stages: LabourStageRef[],
  byStage: Map<number, string>,
): number {
  const qty = new Decimal(orderQty);
  if (qty.lte(0) || stages.length === 0) return 0;
  let sum = new Decimal(0);
  for (const s of stages) {
    const at = new Decimal(byStage.get(s.sequence) ?? "0");
    sum = sum.plus(at.div(qty).times(s.weightPercent));
  }
  return Math.min(100, Math.max(0, Math.round(sum.toNumber())));
}

/**
 * Stage pipeline: first stage capped by order qty; later stages by the
 * previous stage's qty. `qtyByStage` is the amount already posted (before this report).
 */
export function assertStageReportQty(input: {
  stages: LabourStageRef[];
  qtyByStage: Map<number, string>;
  stageSequence: number;
  qtyDone: string;
  orderQty: string;
}): void {
  const stage = input.stages.find((s) => s.sequence === input.stageSequence);
  if (!stage) throw new Error("Unknown labour stage on this SPK");
  const q = new Decimal(input.qtyDone);
  if (q.lte(0)) throw new Error("qtyDone must be greater than 0");
  const sorted = [...input.stages].sort((a, b) => a.sequence - b.sequence);
  const idx = sorted.findIndex((s) => s.sequence === input.stageSequence);
  const cap =
    idx <= 0
      ? new Decimal(input.orderQty)
      : new Decimal(input.qtyByStage.get(sorted[idx - 1]!.sequence) ?? "0");
  const already = new Decimal(input.qtyByStage.get(input.stageSequence) ?? "0");
  const left = cap.minus(already);
  if (q.gt(left)) {
    throw new Error(
      `qtyDone ${formatDecimal(q)} is more than the ${formatDecimal(left.isNeg() ? new Decimal(0) : left)} left on this stage`,
    );
  }
}
