import Decimal from "decimal.js";
import type {
  ProductionItemProgressStatusDto,
  ProductionReadinessCheckOutDto,
  ProductionReadinessItemOutDto,
} from "../../dto/production.dto";
import type { ProductionOrderStatus } from "../../models/productionOrder/productionOrder.model";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import {
  collectSourceLines,
  rabLineKey,
  type BoqLike,
} from "../project/projectRab.planner";

/** Pure rules for releasing a project and sizing SPKs (no DB). */

export type ReadinessItemInput = {
  itemId: string;
  code: string;
  name: string;
  label: string;
  hasShopDrawing: boolean;
  hasBoq: boolean;
  makeQty: string | null;
  hasProductionFile: boolean;
};

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
    return {
      itemId: i.itemId,
      code: i.code,
      name: i.name,
      label: i.label,
      shopDrawing: i.hasShopDrawing,
      boq,
      makeQty: i.hasBoq ? i.makeQty : null,
      productionFile: i.hasProductionFile,
      ready: i.hasShopDrawing && boq && i.hasProductionFile,
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
          : `${readyCount} of ${plural(items.length, "item")} have shop drawing, BOQ and File Produksi`,
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

export type PlannedMaterial = {
  materialItemId: string;
  itemUomId: string;
  qtyPerUnit: string;
  qty: string;
};

/** BOQ lines summed per material×UOM, scaled to the SPK qty. */
export function planMaterials(boq: BoqLike, qty: string): PlannedMaterial[] {
  const perUnit = new Map<string, PlannedMaterial & { sum: Decimal }>();
  for (const line of collectSourceLines([{ ...boq, makeQty: "1" }])) {
    const key = rabLineKey(line.materialItemId, line.itemUomId);
    const row = perUnit.get(key) ?? {
      materialItemId: line.materialItemId,
      itemUomId: line.itemUomId,
      qtyPerUnit: "0",
      qty: "0",
      sum: new Decimal(0),
    };
    row.sum = row.sum.plus(line.qtyPerUnit);
    perUnit.set(key, row);
  }
  const q = new Decimal(qty);
  return [...perUnit.values()].map(({ sum, ...row }) => ({
    ...row,
    qtyPerUnit: formatDecimal(sum),
    qty: formatDecimal(sum.times(q)),
  }));
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
