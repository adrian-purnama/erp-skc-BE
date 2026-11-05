import { Types } from "mongoose";
import type { ProjectCalendarEventOutDto } from "../../dto/projectCalendar.dto";
import type {
  ProjectSCurveOutDto,
  ProjectScheduleOutDto,
  SaveProjectScheduleDto,
  SCurvePeriod,
} from "../../dto/projectSchedule.dto";
import { ProductionOrderRepo } from "../../models/productionOrder.model";
import { ProductionReportRepo } from "../../models/productionReport.model";
import { ProjectRepo } from "../../models/project.model";
import { ProjectRabRepo, type ProjectRabLine } from "../../models/projectRab.model";
import {
  ProjectScheduleRepo,
  type ProjectScheduleInterface,
  type ProjectScheduleItem,
} from "../../models/projectSchedule.model";
import {
  ProjectShopDrawingBoqRepo,
  type ProjectShopDrawingBoqInterface,
} from "../../models/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument.model";
import {
  ProjectShopDrawingItemRepo,
  type ShopDrawingMakeType,
} from "../../models/projectShopDrawingItem.model";
import { jakartaYmdString } from "../../utils/shared";
import type { StageLine } from "../production/production.planner";
import { orderLineKey } from "../production/stageFlow";
import { isLabourLine, labourRole, type BoqLike } from "./projectRab.planner";
import { loadRabUomPlan } from "./projectRabUomPlan";
import {
  buildSCurve,
  itemValues,
  itemWeights,
  scheduleCalendarEvents,
  scheduleWarnings,
  type ItemWeight,
  type SCurveActualItem,
  type SCurvePlanItem,
} from "./projectSCurve.planner";
import { assertProjectExists, shopDrawingItemLabel } from "./projectShared";

type LeanItem = {
  _id: Types.ObjectId;
  code?: string;
  name: string;
  makeType?: ShopDrawingMakeType;
  makeQty?: string | null;
};
type LeanBoq = ProjectShopDrawingBoqInterface & { _id: Types.ObjectId };
type LeanSchedule = ProjectScheduleInterface & { _id: Types.ObjectId };

type ItemRow = {
  itemId: string;
  label: string;
  item: LeanItem;
  boq: LeanBoq | null;
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Live items with their current shop drawing's BOQ, in code order. */
async function loadItems(projectId: string): Promise<ItemRow[]> {
  const projectOid = new Types.ObjectId(projectId);
  const [items, sdFiles] = await Promise.all([
    ProjectShopDrawingItemRepo.model
      .find({ projectId: projectOid, isDeleted: false })
      .select({ code: 1, name: 1, makeType: 1, makeQty: 1 })
      .sort({ code: 1, name: 1 })
      .lean()
      .exec() as Promise<LeanItem[]>,
    ProjectShopDrawingDocumentRepo.model
      .find({ projectId: projectOid, isCurrent: true, isDeleted: { $ne: true } })
      .select({ itemId: 1 })
      .lean()
      .exec(),
  ]);
  const boqs = (await ProjectShopDrawingBoqRepo.model
    .find({ projectId: projectOid, shopDrawingFileId: { $in: sdFiles.map((f) => f._id) } })
    .lean()
    .exec()) as LeanBoq[];
  const fileByItem = new Map(sdFiles.map((f) => [String(f.itemId), String(f._id)]));
  const boqByFile = new Map(boqs.map((b) => [String(b.shopDrawingFileId), b]));
  return items.map((item) => {
    const fileId = fileByItem.get(String(item._id));
    return {
      itemId: String(item._id),
      label: shopDrawingItemLabel(item),
      item,
      boq: fileId ? (boqByFile.get(fileId) ?? null) : null,
    };
  });
}

async function loadRabLines(projectId: string): Promise<ProjectRabLine[]> {
  const rab = await ProjectRabRepo.model
    .findOne({ projectId: new Types.ObjectId(projectId) })
    .select({ lines: 1 })
    .lean()
    .exec();
  return (rab?.lines ?? []) as ProjectRabLine[];
}

/** Item id → bobot + install share, from the committed RAB. */
async function loadWeights(
  items: ItemRow[],
  rabLines: ProjectRabLine[],
): Promise<Map<string, ItemWeight>> {
  const boqs = items.flatMap((i) => (i.boq ? [i.boq as BoqLike] : []));
  const values = itemValues({
    items: items.map((i) => ({ itemId: i.itemId, boq: i.boq as BoqLike | null })),
    rabLines: rabLines.map((l) => ({
      key: l.key,
      totalQty: l.totalQty,
      unitPrice: l.unitPrice ?? null,
      origin: l.origin ?? null,
      role: l.role ?? null,
      shopDrawingItemId: l.shopDrawingItemId ? String(l.shopDrawingItemId) : null,
    })),
    uomPlan: await loadRabUomPlan(boqs),
  });
  return itemWeights(values);
}

async function loadSchedule(projectId: string): Promise<LeanSchedule | null> {
  return (await ProjectScheduleRepo.model
    .findOne({ projectId: new Types.ObjectId(projectId) })
    .lean()
    .exec()) as LeanSchedule | null;
}

function windowsOf(row: ProjectScheduleItem | undefined) {
  return {
    makeStart: row?.makeStart ?? null,
    makeFinish: row?.makeFinish ?? null,
    installStart: row?.installStart ?? null,
    installFinish: row?.installFinish ?? null,
  };
}

/** Current plan rows: every live item, with its saved windows and live weights. */
function planItems(
  items: ItemRow[],
  schedule: LeanSchedule | null,
  weights: Map<string, ItemWeight>,
): Array<SCurvePlanItem & { label: string; value: string }> {
  const byItem = new Map(
    (schedule?.items ?? []).map((r) => [String(r.shopDrawingItemId), r]),
  );
  return items.map((i) => {
    const w = weights.get(i.itemId);
    return {
      itemId: i.itemId,
      label: i.label,
      weightPercent: w?.weightPercent ?? 0,
      installSharePercent: w?.installSharePercent ?? 0,
      value: w?.value ?? "0",
      ...windowsOf(byItem.get(i.itemId)),
    };
  });
}

/** Pcs to make: an outsource item's own qty, else its BOQ's, else a released SPK's snapshot. */
function makeQtyOf(row: ItemRow, snapshotQty: string | undefined): string {
  if ((row.item.makeType ?? "inhouse") === "outsource" && row.item.makeQty) {
    return row.item.makeQty;
  }
  return row.boq?.makeQty ?? snapshotQty ?? "0";
}

function stageLinesByItem(rabLines: ProjectRabLine[]): Map<string, StageLine[]> {
  const out = new Map<string, StageLine[]>();
  for (const l of rabLines) {
    if (!isLabourLine(l) || !l.shopDrawingItemId) continue;
    const itemId = String(l.shopDrawingItemId);
    const list = out.get(itemId) ?? [];
    list.push({
      key: l.key,
      role: labourRole(l),
      sequence: l.sequence ?? null,
      weightPercent: l.weightPercent ?? null,
    });
    out.set(itemId, list);
  }
  return out;
}

async function loadActual(
  projectId: string,
  items: ItemRow[],
  rabLines: ProjectRabLine[],
  weights: Map<string, ItemWeight>,
): Promise<SCurveActualItem[]> {
  const projectOid = new Types.ObjectId(projectId);
  const [orders, reports] = await Promise.all([
    ProductionOrderRepo.model
      .find({ projectId: projectOid })
      .select({ shopDrawingItemId: 1, labourItemId: 1, labourUomId: 1, "snapshot.makeQty": 1 })
      .lean()
      .exec(),
    ProductionReportRepo.model
      .find({ projectId: projectOid, isVoided: false })
      .select({ productionOrderId: 1, shopDrawingItemId: 1, qtyDone: 1, reportDate: 1 })
      .lean()
      .exec(),
  ]);
  const lineKeyByOrder = new Map(orders.map((o) => [String(o._id), orderLineKey(o)]));
  const snapshotQty = new Map<string, string>();
  for (const o of orders) {
    const qty = o.snapshot?.makeQty;
    if (qty) snapshotQty.set(String(o.shopDrawingItemId), qty);
  }
  const reportsByItem = new Map<string, SCurveActualItem["reports"]>();
  for (const r of reports) {
    const lineKey = lineKeyByOrder.get(String(r.productionOrderId));
    if (!lineKey) continue;
    const itemId = String(r.shopDrawingItemId);
    const list = reportsByItem.get(itemId) ?? [];
    list.push({ date: r.reportDate, lineKey, qty: r.qtyDone });
    reportsByItem.set(itemId, list);
  }
  const linesByItem = stageLinesByItem(rabLines);
  return items.map((i) => ({
    itemId: i.itemId,
    weightPercent: weights.get(i.itemId)?.weightPercent ?? 0,
    installSharePercent: weights.get(i.itemId)?.installSharePercent ?? 0,
    makeQty: makeQtyOf(i, snapshotQty.get(i.itemId)),
    lines: linesByItem.get(i.itemId) ?? [],
    reports: reportsByItem.get(i.itemId) ?? [],
  }));
}

type ProjectDates = { plannedStartDate: string | null; plannedFinishDate: string | null };

/** The project's own planned start/finish (project metadata). */
async function loadProjectDates(projectId: string): Promise<ProjectDates> {
  const doc = await ProjectRepo.model
    .findById(projectId)
    .select({ plannedStartDate: 1, plannedFinishDate: 1 })
    .lean()
    .exec();
  return {
    plannedStartDate: doc?.plannedStartDate ?? null,
    plannedFinishDate: doc?.plannedFinishDate ?? null,
  };
}

export class ProjectScheduleService {
  async get(projectId: string): Promise<ProjectScheduleOutDto> {
    await assertProjectExists(projectId);
    const [items, rabLines, schedule, dates] = await Promise.all([
      loadItems(projectId),
      loadRabLines(projectId),
      loadSchedule(projectId),
      loadProjectDates(projectId),
    ]);
    const weights = await loadWeights(items, rabLines);
    const plan = planItems(items, schedule, weights);
    return {
      projectId,
      ...dates,
      items: plan.map((p) => ({
        itemId: p.itemId,
        label: p.label,
        weightPercent: r2(p.weightPercent),
        installSharePercent: r2(p.installSharePercent),
        value: p.value,
        makeStart: p.makeStart ?? null,
        makeFinish: p.makeFinish ?? null,
        installStart: p.installStart ?? null,
        installFinish: p.installFinish ?? null,
      })),
      baseline: schedule?.baseline
        ? {
            setAt: new Date(schedule.baseline.setAt).toISOString(),
            plannedStartDate: schedule.baseline.plannedStartDate,
            plannedFinishDate: schedule.baseline.plannedFinishDate,
          }
        : null,
      warnings: scheduleWarnings({ ...dates, items: plan }),
    };
  }

  /** Saves the item windows, and the project's planned dates (same fields as Edit project). */
  async save(projectId: string, dto: SaveProjectScheduleDto): Promise<ProjectScheduleOutDto> {
    await assertProjectExists(projectId);
    const live = new Set((await loadItems(projectId)).map((i) => i.itemId));
    const unknown = dto.items.find((i) => !live.has(i.itemId));
    if (unknown) throw new Error("A schedule row is not a live item of this project");
    const items = dto.items.map((i) => ({
      shopDrawingItemId: new Types.ObjectId(i.itemId),
      makeStart: i.makeStart,
      makeFinish: i.makeFinish,
      installStart: i.installStart,
      installFinish: i.installFinish,
    }));
    const existing = await loadSchedule(projectId);
    if (existing) {
      await ProjectScheduleRepo.findOneAndUpdate({ _id: existing._id }, { $set: { items } });
    } else {
      await ProjectScheduleRepo.create({
        projectId: new Types.ObjectId(projectId),
        items,
        baseline: null,
      });
    }
    const dates = await loadProjectDates(projectId);
    if (
      dates.plannedStartDate !== dto.plannedStartDate ||
      dates.plannedFinishDate !== dto.plannedFinishDate
    ) {
      await ProjectRepo.findByIdAndUpdate(projectId, {
        $set: {
          plannedStartDate: dto.plannedStartDate,
          plannedFinishDate: dto.plannedFinishDate,
        },
      });
    }
    return this.get(projectId);
  }

  /** Freeze the current plan (dates + weights) as the baseline, replacing any old one. */
  async setBaseline(projectId: string, userId: string): Promise<ProjectScheduleOutDto> {
    await assertProjectExists(projectId);
    const [items, rabLines, schedule, dates] = await Promise.all([
      loadItems(projectId),
      loadRabLines(projectId),
      loadSchedule(projectId),
      loadProjectDates(projectId),
    ]);
    if (!dates.plannedStartDate || !dates.plannedFinishDate) {
      throw new Error("Set the project planned start and finish dates first");
    }
    if (!schedule) throw new Error("Save the schedule first");
    const weights = await loadWeights(items, rabLines);
    const plan = planItems(items, schedule, weights);
    const missing = plan.filter(
      (p) =>
        p.weightPercent > 0 &&
        (!p.makeStart ||
          !p.makeFinish ||
          (p.installSharePercent > 0 && (!p.installStart || !p.installFinish))),
    );
    if (missing.length > 0) {
      throw new Error(
        `Plan every window before setting a baseline: ${missing.map((p) => p.label).join(", ")}`,
      );
    }
    await ProjectScheduleRepo.findOneAndUpdate(
      { _id: schedule._id },
      {
        $set: {
          baseline: {
            setAt: new Date(),
            setBy: Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null,
            plannedStartDate: dates.plannedStartDate,
            plannedFinishDate: dates.plannedFinishDate,
            items: plan.map((p) => ({
              shopDrawingItemId: new Types.ObjectId(p.itemId),
              makeStart: p.makeStart ?? null,
              makeFinish: p.makeFinish ?? null,
              installStart: p.installStart ?? null,
              installFinish: p.installFinish ?? null,
              weightPercent: p.weightPercent,
              installSharePercent: p.installSharePercent,
            })),
          },
        },
      },
    );
    return this.get(projectId);
  }

  async sCurve(projectId: string, period: SCurvePeriod): Promise<ProjectSCurveOutDto> {
    await assertProjectExists(projectId);
    const [items, rabLines, schedule, dates] = await Promise.all([
      loadItems(projectId),
      loadRabLines(projectId),
      loadSchedule(projectId),
      loadProjectDates(projectId),
    ]);
    const weights = await loadWeights(items, rabLines);
    const current = planItems(items, schedule, weights);
    const actual = await loadActual(projectId, items, rabLines, weights);
    const baseline = schedule?.baseline ?? null;
    const result = buildSCurve({
      period,
      today: jakartaYmdString(new Date()),
      ...dates,
      current,
      baseline: baseline
        ? {
            plannedStartDate: baseline.plannedStartDate,
            plannedFinishDate: baseline.plannedFinishDate,
            items: baseline.items.map((b) => ({
              itemId: String(b.shopDrawingItemId),
              weightPercent: b.weightPercent,
              installSharePercent: b.installSharePercent,
              ...windowsOf(b),
            })),
          }
        : null,
      actual,
    });
    return {
      projectId,
      period,
      ...dates,
      baselineSetAt: baseline ? new Date(baseline.setAt).toISOString() : null,
      ...result,
    };
  }

  /**
   * Read-only calendar events: each project's planned start/finish and its
   * item windows. One project, or every project when no id.
   */
  async calendarEvents(projectId?: string): Promise<ProjectCalendarEventOutDto[]> {
    const scheduleFilter = projectId ? { projectId: new Types.ObjectId(projectId) } : {};
    const [schedules, projects] = await Promise.all([
      ProjectScheduleRepo.model.find(scheduleFilter).lean().exec() as Promise<LeanSchedule[]>,
      ProjectRepo.model
        .find(
          projectId
            ? { _id: new Types.ObjectId(projectId) }
            : {
                $or: [
                  { plannedStartDate: { $nin: [null, ""] } },
                  { plannedFinishDate: { $nin: [null, ""] } },
                ],
              },
        )
        .select({ plannedStartDate: 1, plannedFinishDate: 1 })
        .lean()
        .exec(),
    ]);
    const itemIds = schedules.flatMap((s) => s.items.map((i) => i.shopDrawingItemId));
    const items =
      itemIds.length > 0
        ? ((await ProjectShopDrawingItemRepo.model
            .find({ _id: { $in: itemIds }, isDeleted: false })
            .select({ code: 1, name: 1 })
            .lean()
            .exec()) as LeanItem[])
        : [];
    const labels = new Map(items.map((i) => [String(i._id), shopDrawingItemLabel(i)]));
    const scheduleByProject = new Map(schedules.map((s) => [String(s.projectId), s]));
    const projectIds = new Set([
      ...projects.map((p) => String(p._id)),
      ...scheduleByProject.keys(),
    ]);
    const datesById = new Map(projects.map((p) => [String(p._id), p]));
    return [...projectIds].flatMap((id) => {
      const s = scheduleByProject.get(id);
      const d = datesById.get(id);
      return scheduleCalendarEvents({
        projectId: id,
        plannedStartDate: d?.plannedStartDate ?? null,
        plannedFinishDate: d?.plannedFinishDate ?? null,
        items: (s?.items ?? []).flatMap((i) => {
          const label = labels.get(String(i.shopDrawingItemId));
          return label ? [{ itemId: String(i.shopDrawingItemId), label, ...windowsOf(i) }] : [];
        }),
      });
    });
  }
}

export const projectScheduleService = new ProjectScheduleService();
