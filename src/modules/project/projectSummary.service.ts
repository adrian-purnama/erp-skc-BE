import { Types } from "mongoose";
import type { ProjectSummaryOutDto } from "../../dto/project.dto";
import { ProjectRepo } from "../../models/project.model";
import { ProjectCalendarEventRepo } from "../../models/projectCalendarEvent.model";
import { ProjectScheduleRepo } from "../../models/projectSchedule.model";
import { ProjectRabRepo } from "../../models/projectRab.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem.model";
import { projectScheduleService } from "./projectSchedule.service";
import { buildProjectSummary, type SummaryInput, type SummaryQuotation, type SummaryRab, type SummarySchedule } from "./projectSummary.planner";
import { productionPort, purchasingPort, quotationPort } from "./project.ports";

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

/** Today's S-curve reading for each project that has a schedule. */
async function scheduleReadings(
  ids: Types.ObjectId[],
): Promise<Map<string, SummarySchedule>> {
  const schedules = await ProjectScheduleRepo.model
    .find({ projectId: { $in: ids } })
    .select({ projectId: 1 })
    .lean()
    .exec();
  const out = new Map<string, SummarySchedule>();
  await Promise.all(
    schedules.map(async (s) => {
      const id = String(s.projectId);
      try {
        const curve = await projectScheduleService.sCurve(id, "week");
        if (curve.points.length === 0) return;
        out.set(id, {
          plannedPct: curve.today.plannedPct,
          actualPct: curve.today.actualPct,
          deviationPct: curve.today.deviationPct,
        });
      } catch {
        // A broken schedule must not break the project list.
      }
    }),
  );
  return out;
}

/** Bulk-loads list roll-ups for many projects (a fixed number of queries, plus one S-curve per scheduled project). */
export async function summarizeProjects(
  projectIds: string[],
): Promise<Map<string, ProjectSummaryOutDto>> {
  const ids = projectIds.map((id) => new Types.ObjectId(id));
  const inIds = { $in: ids };

  const [projects, schedules] = await Promise.all([
    ProjectRepo.model
      .find({ _id: inIds })
      .select({ status: 1, plannedFinishDate: 1 })
      .lean()
      .exec(),
    scheduleReadings(ids),
  ]);
  const projectBy = new Map(projects.map((p) => [String(p._id), p] as const));

  const [quotations, rabs, production, events, drawingCounts, realizationCosts] =
    await Promise.all([
      quotationPort().contractQuotations(projectIds),
      ProjectRabRepo.model
        .find({ projectId: inIds })
        .select({
          projectId: 1,
          status: 1,
          "lines.totalQty": 1,
          "lines.unitPrice": 1,
          charges: 1,
        })
        .lean()
        .exec(),
      productionPort().summaryInputs(projectIds),
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
      purchasingPort().realizedCosts(projectIds),
    ]);

  const quotationsBy = groupBy(quotations, (q) => q.projectId);
  const rabBy = new Map(rabs.map((r) => [String(r.projectId), r] as const));
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
          taxBase: q.taxBase,
          grandTotal: q.grandTotal,
        }),
      ),
      rab: rab
        ? ({
            status: rab.status,
            lines: rab.lines ?? [],
            charges: rab.charges ?? [],
          } satisfies SummaryRab)
        : null,
      realizationTotals: (realizationsBy.get(id) ?? []).map((c) => c.amount),
      shopDrawingCount: drawingsBy.get(id) ?? 0,
      orders: production.get(id)?.orders ?? [],
      reportQtys: production.get(id)?.reportQtys ?? [],
      productionPercent: production.get(id)?.productionPercent ?? null,
      deadlines: (eventsBy.get(id) ?? []).map((e) => ({
        at: e.startAt,
        title: e.title,
      })),
      status: projectBy.get(id)?.status ?? "open",
      plannedFinishDate: projectBy.get(id)?.plannedFinishDate ?? null,
      schedule: schedules.get(id) ?? null,
      now,
    };
    out.set(id, buildProjectSummary(input));
  }
  return out;
}
