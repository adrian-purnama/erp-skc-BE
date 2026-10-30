import { Types } from "mongoose";
import type { ProjectSummaryOutDto } from "../../dto/project.dto";
import { ProductionOrderRepo } from "../../models/productionOrder.model";
import { ProductionReportRepo } from "../../models/productionReport.model";
import { ProjectCalendarEventRepo } from "../../models/projectCalendarEvent.model";
import { ProjectQuotationRepo } from "../../models/projectQuotation.model";
import { ProjectRabRepo } from "../../models/projectRab.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem.model";
import { PurchaseOrderRepo } from "../../models/purchaseOrder.model";
import { PurchaseRealizationRepo } from "../../models/purchaseRealization.model";
import {
  allocateRealizationCost,
  buildProjectSummary,
  type SummaryInput,
  type SummaryQuotation,
  type SummaryRab,
} from "./projectSummary.planner";

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/** Bulk-loads list roll-ups for many projects (a fixed number of queries). */
export async function summarizeProjects(
  projectIds: string[],
): Promise<Map<string, ProjectSummaryOutDto>> {
  const ids = projectIds.map((id) => new Types.ObjectId(id));
  const inIds = { $in: ids };

  const [quotations, rabs, orders, reports, events, drawingCounts, pos] =
    await Promise.all([
      ProjectQuotationRepo.model
        .find({ projectId: inIds, status: { $in: ["won", "issued"] } })
        .select({
          projectId: 1,
          status: 1,
          revision: 1,
          discountType: 1,
          discountValue: 1,
          taxPercent: 1,
          "lines.qty": 1,
          "lines.unitPrice": 1,
          "lines.costUnitPrice": 1,
        })
        .lean()
        .exec(),
      ProjectRabRepo.model
        .find({ projectId: inIds })
        .select({ projectId: 1, status: 1, "lines.totalQty": 1, "lines.unitPrice": 1 })
        .lean()
        .exec(),
      ProductionOrderRepo.model
        .find({ projectId: inIds, status: { $ne: "cancelled" } })
        .select({ projectId: 1, qty: 1, plannedFinish: 1 })
        .lean()
        .exec(),
      ProductionReportRepo.model
        .find({ projectId: inIds, isVoided: false })
        .select({ projectId: 1, qtyDone: 1 })
        .lean()
        .exec(),
      ProjectCalendarEventRepo.model
        .find({ projectId: inIds, type: "deadline" })
        .select({ projectId: 1, startAt: 1, title: 1 })
        .lean()
        .exec(),
      ProjectShopDrawingItemRepo.model
        .aggregate<{ _id: Types.ObjectId; count: number }>([
          { $match: { projectId: inIds, isDeleted: false } },
          { $group: { _id: "$projectId", count: { $sum: 1 } } },
        ])
        .exec(),
      PurchaseOrderRepo.model
        .find({ "lines.projectId": inIds })
        .select({ "lines._id": 1, "lines.projectId": 1 })
        .lean()
        .exec(),
    ]);

  // Project ids live on PO lines; realization lines point at them.
  const projectByPoLine = new Map<string, string>();
  for (const po of pos) {
    for (const line of po.lines ?? []) {
      if (line._id && line.projectId) {
        projectByPoLine.set(String(line._id), String(line.projectId));
      }
    }
  }
  const realizations = await PurchaseRealizationRepo.model
    .find({
      purchaseOrderId: { $in: pos.map((po) => po._id) },
      status: "posted",
    })
    .select({ lines: 1, subtotal: 1, total: 1 })
    .lean()
    .exec();
  const realizationCosts = realizations.flatMap((r) =>
    allocateRealizationCost(
      {
        lines: (r.lines ?? []).map((l) => ({
          projectId: projectByPoLine.get(String(l.poLineId)) ?? null,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
        subtotal: r.subtotal,
        total: r.total,
      },
    ),
  );

  const quotationsBy = groupBy(quotations, (q) => String(q.projectId));
  const rabBy = new Map(rabs.map((r) => [String(r.projectId), r] as const));
  const ordersBy = groupBy(orders, (o) => String(o.projectId));
  const reportsBy = groupBy(reports, (r) => String(r.projectId));
  const eventsBy = groupBy(events, (e) => String(e.projectId));
  const drawingsBy = new Map(
    drawingCounts.map((d) => [String(d._id), d.count] as const),
  );
  const realizationsBy = groupBy(realizationCosts, (c) => c.projectId);

  const now = new Date();
  const out = new Map<string, ProjectSummaryOutDto>();
  for (const id of projectIds) {
    const rab = rabBy.get(id);
    const input: SummaryInput = {
      quotations: (quotationsBy.get(id) ?? []).map(
        (q): SummaryQuotation => ({
          status: q.status,
          revision: q.revision,
          discountType: q.discountType,
          discountValue: q.discountValue,
          taxPercent: q.taxPercent,
          lines: q.lines ?? [],
        }),
      ),
      rab: rab
        ? ({ status: rab.status, lines: rab.lines ?? [] } satisfies SummaryRab)
        : null,
      realizationTotals: (realizationsBy.get(id) ?? []).map((c) => c.amount),
      shopDrawingCount: drawingsBy.get(id) ?? 0,
      orders: ordersBy.get(id) ?? [],
      reportQtys: (reportsBy.get(id) ?? []).map((r) => r.qtyDone),
      deadlines: (eventsBy.get(id) ?? []).map((e) => ({
        at: e.startAt,
        title: e.title,
      })),
      now,
    };
    out.set(id, buildProjectSummary(input));
  }
  return out;
}
