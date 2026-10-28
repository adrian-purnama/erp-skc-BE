import Decimal from "decimal.js";
import type { PurchaseRequestLineSource } from "../../models/purchaseRequest/purchaseRequest.model";
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

export type CheckedRequestLine = RequestLineInput & {
  /** `spk` when the material×UOM is on the SPK list, else `extra`. */
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

/** Σ qty per material×UOM over SPK lines of other live requests. */
export function sumRequested(
  lines: Array<{ source: PurchaseRequestLineSource; materialItemId: string; itemUomId: string; qty: string }>,
): Map<string, Decimal> {
  const sums = new Map<string, Decimal>();
  for (const line of lines) {
    if (line.source !== "spk") continue;
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
 * Validate SPP lines and flag them. A line is an SPK line when its
 * material×UOM is on the SPK list, otherwise an extra item (needs a reason).
 * `spkMaterials` is null when the request has no SPK.
 */
export function checkRequestLines(input: {
  lines: RequestLineInput[];
  spkMaterials: SpkMaterialRow[] | null;
  requested: Map<string, Decimal>;
  rabKeys: Set<string>;
  label: (key: string) => string;
}): CheckedRequestLine[] {
  if (input.lines.length === 0) throw new Error("Add at least one material");
  const planned = new Map(
    (input.spkMaterials ?? []).map((m) => [materialKey(m), new Decimal(m.qty)]),
  );
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
          `${name}: ${formatDecimal(total)} requested in total is more than the ${formatDecimal(plan)} the SPK needs; add a reason`,
        );
      }
      return { ...line, source: "spk", note, inRab, overPlan };
    }

    if (!note) throw new Error(`${name}: add a reason for this item outside the SPK`);
    return { ...line, source: "extra", note, inRab, overPlan: false };
  });
}
