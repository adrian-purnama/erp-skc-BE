import Decimal from "decimal.js";
import type { PurchaseRequestLineSource } from "../../models/purchaseRequest.model";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { rabLineKey } from "../project/projectRab.planner";

/** Pure rules for SPP lines (no DB). */

export type SpkMaterialRow = {
  materialItemId: string;
  itemUomId: string;
  /** Total qty the SPK needs (snapshot). */
  qty: string;
};

export type RequestLineInput = {
  materialItemId: string;
  itemUomId: string;
  qty: string;
  note: string;
};

/** What an SPP is checked against: an SPK's material list or a Purchasing RAB. */
export type RequestBasis = "spk" | "rab";

export type CheckedRequestLine = RequestLineInput & {
  /** The basis when the material×UOM is on its list, else `extra`. */
  source: PurchaseRequestLineSource;
  inRab: boolean;
  overPlan: boolean;
};

export type RequestPlanRow = SpkMaterialRow & {
  plannedQty: string;
  requestedQty: string;
  /** plannedQty − requestedQty, never below 0. */
  remainingQty: string;
};

export function materialKey(row: { materialItemId: string; itemUomId: string }): string {
  return rabLineKey(row.materialItemId, row.itemUomId);
}

/** Σ qty per material×UOM over SPK / RAB lines of other live requests. */
export function sumRequested(
  lines: Array<{ source: PurchaseRequestLineSource; materialItemId: string; itemUomId: string; qty: string }>,
): Map<string, Decimal> {
  const sums = new Map<string, Decimal>();
  for (const line of lines) {
    if (line.source === "extra") continue;
    const key = materialKey(line);
    sums.set(key, (sums.get(key) ?? new Decimal(0)).plus(line.qty));
  }
  return sums;
}

/** SPK materials with what is already requested and what is left. */
export function requestPlan(
  spkMaterials: SpkMaterialRow[],
  requested: Map<string, Decimal>,
): RequestPlanRow[] {
  return spkMaterials.map((m) => {
    const asked = requested.get(materialKey(m)) ?? new Decimal(0);
    const left = new Decimal(m.qty).minus(asked);
    return {
      ...m,
      plannedQty: m.qty,
      requestedQty: formatDecimal(asked),
      remainingQty: formatDecimal(left.isNeg() ? new Decimal(0) : left),
    };
  });
}

/**
 * Validate SPP lines and flag them. A line is an SPK / RAB line when its
 * material×UOM is on the basis list, otherwise an extra item (needs a reason).
 * `planMaterials` is null for an older request with neither SPK nor RAB.
 */
export function checkRequestLines(input: {
  lines: RequestLineInput[];
  basis: RequestBasis;
  planMaterials: SpkMaterialRow[] | null;
  requested: Map<string, Decimal>;
  rabKeys: Set<string>;
  label: (key: string) => string;
}): CheckedRequestLine[] {
  if (input.lines.length === 0) throw new Error("Add at least one material");
  const planned = new Map(
    (input.planMaterials ?? []).map((m) => [materialKey(m), new Decimal(m.qty)]),
  );
  const what = input.basis === "rab" ? "RAB" : "SPK";
  const seen = new Set<string>();
  return input.lines.map((line) => {
    const key = materialKey(line);
    const name = input.label(key);
    if (seen.has(key)) throw new Error(`${name} is listed twice`);
    seen.add(key);
    const qty = new Decimal(line.qty);
    if (qty.lte(0)) throw new Error(`${name}: qty must be greater than 0`);
    const note = line.note.trim();
    const inRab = input.rabKeys.has(key);

    const plan = planned.get(key);
    if (plan) {
      const total = (input.requested.get(key) ?? new Decimal(0)).plus(qty);
      const overPlan = total.gt(plan);
      if (overPlan && !note) {
        throw new Error(
          `${name}: ${formatDecimal(total)} requested in total is more than the ${formatDecimal(plan)} ${
            input.basis === "rab" ? "the RAB budgets" : "the SPK needs"
          }; add a reason`,
        );
      }
      return { ...line, source: input.basis, note, inRab, overPlan };
    }

    if (!note) throw new Error(`${name}: add a reason for this item outside the ${what}`);
    return { ...line, source: "extra", note, inRab, overPlan: false };
  });
}

/** Per SPK / RAB material: what is requested, ordered and received so far. */
export type MaterialFlowRow = {
  key: string;
  requested: Decimal;
  ordered: Decimal;
  received: Decimal;
};

/** Add one SPP line's numbers into the per-material roll-up. */
export function addFlow(
  rows: Map<string, MaterialFlowRow>,
  key: string,
  part: { requested?: string; ordered?: Decimal; received?: Decimal },
): void {
  const row = rows.get(key) ?? {
    key,
    requested: new Decimal(0),
    ordered: new Decimal(0),
    received: new Decimal(0),
  };
  if (part.requested) row.requested = row.requested.plus(part.requested);
  if (part.ordered) row.ordered = row.ordered.plus(part.ordered);
  if (part.received) row.received = row.received.plus(part.received);
  rows.set(key, row);
}
