import type {
  HeldLabourLine,
  ProductionForProject,
  ProductionSummaryInputs,
  ScheduleActuals,
} from "../project";
import { formatDecimal, parseQtyDecimal } from "../../utils/decimal";
import { allocatedQty } from "./production.planner";
import { countLiveOrdersForShopDrawingItem, listProductionOrders, listValidReports } from "./production.public";
import { productionService } from "./production.service";
import { assertProcessKept, heldQtyOnItem, orderLineKey } from "./stageFlow";

/** Σ valid report qty per SPK id. */
function doneByOrder(reports: Array<{ productionOrderId: string; qtyDone: string }>): Map<string, string> {
  const done = new Map<string, string>();
  for (const r of reports) {
    const key = r.productionOrderId;
    done.set(key, formatDecimal(parseQtyDecimal(done.get(key) ?? "0").add(r.qtyDone)));
  }
  return done;
}

/** Live SPKs grouped by RAB labour line, with the qty each line holds (first-seen line order). */
async function heldLabourLines(projectId: string): Promise<HeldLabourLine[]> {
  const orders = await listProductionOrders([projectId]);
  if (orders.length === 0) return [];
  const done = doneByOrder(await listValidReports({ orderIds: orders.map((o) => o.id) }));
  const out: HeldLabourLine[] = [];
  for (const key of new Set(orders.map(orderLineKey))) {
    const lineOrders = orders.filter((o) => orderLineKey(o) === key);
    const first = lineOrders[0]!;
    const held = allocatedQty(
      lineOrders.map((o) => ({ id: o.id, status: o.status, qty: o.qty })),
      done,
    );
    out.push({
      key,
      shopDrawingItemId: first.shopDrawingItemId,
      labourName: first.labourName,
      role: first.role,
      executor: first.executor,
      heldQty: formatDecimal(held),
    });
  }
  return out;
}

/** S-curve actuals: frozen make qty per item and valid reports keyed to their RAB line. */
async function scheduleActuals(projectId: string): Promise<ScheduleActuals> {
  // Cancelled SPKs stay in: their reports still map to a RAB line.
  const [orders, reports] = await Promise.all([
    listProductionOrders([projectId], { includeCancelled: true }),
    listValidReports({ projectIds: [projectId] }),
  ]);
  const lineKeyByOrder = new Map(orders.map((o) => [o.id, orderLineKey(o)]));
  const makeQtyByItem = new Map<string, string>();
  for (const o of orders) {
    if (o.makeQty) makeQtyByItem.set(o.shopDrawingItemId, o.makeQty);
  }
  const out: ScheduleActuals["reports"] = [];
  for (const r of reports) {
    const lineKey = lineKeyByOrder.get(r.productionOrderId);
    if (!lineKey) continue;
    out.push({ itemId: r.shopDrawingItemId, lineKey, date: r.reportDate, qty: r.qtyDone });
  }
  return { makeQtyByItem, reports: out };
}

/** Per project: live SPK qty / planned finish, valid report qty, and the Production page %. */
async function summaryInputs(projectIds: string[]): Promise<Map<string, ProductionSummaryInputs>> {
  const [orders, reports] = await Promise.all([
    listProductionOrders(projectIds),
    listValidReports({ projectIds }),
  ]);
  const out = new Map<string, ProductionSummaryInputs>();
  const entry = (id: string) => {
    let e = out.get(id);
    if (!e) {
      e = { orders: [], reportQtys: [], productionPercent: null };
      out.set(id, e);
    }
    return e;
  };
  for (const o of orders) entry(o.projectId).orders.push({ qty: o.qty, plannedFinish: o.plannedFinish });
  for (const r of reports) entry(r.projectId).reportQtys.push(r.qtyDone);
  const withOrders = [...new Set(orders.map((o) => o.projectId))];
  await Promise.all(
    withOrders.map(async (id) => {
      try {
        entry(id).productionPercent = (await productionService.progress(id)).totals.percent;
      } catch {
        // A broken item must not break the project list.
      }
    }),
  );
  return out;
}

/** Production's implementation of the project module's port. */
export const productionForProject: ProductionForProject = {
  heldLabourLines,
  assertProcessKept,
  heldQtyOnItem,
  countLiveOrdersForShopDrawingItem,
  scheduleActuals,
  summaryInputs,
};
