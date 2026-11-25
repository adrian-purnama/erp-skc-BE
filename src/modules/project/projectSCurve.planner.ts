import Decimal from "decimal.js";
import type { ProjectCalendarEventOutDto } from "../../dto/projectCalendar.dto";
import type {
  ProjectSCurveItemOutDto,
  ProjectSCurveOutDto,
  ProjectSCurvePointOutDto,
  SCurvePeriod,
} from "../../dto/projectSchedule.dto";
import { addJakartaDays } from "../../utils/time";
import { formatDecimal, parseQtyDecimal } from "../../utils/decimal";
import { trackPercentExact, type StageLine } from "./projectStages.planner";
import {
  collectSourceLines,
  isLabourLine,
  labourRole,
  resolveRabTarget,
  type BoqLike,
  type RabUomPlan,
} from "./projectRab.planner";

/**
 * Project S-curve (Kurva S): item weights from RAB value, a planned curve
 * spread linearly over each item's making / install window (calendar days),
 * and an actual curve replayed from production reports by date.
 */

// ---------- weights ----------

export type RabLineLike = {
  key: string;
  totalQty: string;
  unitPrice?: string | null;
  origin?: string | null;
  role?: "making" | "install" | null;
  shopDrawingItemId?: string | null;
};

export type ItemValue = {
  itemId: string;
  /** Materials (BOQ need × RAB price) + making labour. */
  makingValue: string;
  /** Install labour. */
  installValue: string;
};

export type ItemWeight = {
  /** Share of the project, 0–100, unrounded. */
  weightPercent: number;
  /** Install share inside the item, 0–100, unrounded. */
  installSharePercent: number;
  /** Item RAB value (IDR). */
  value: string;
};

function priceOf(line: RabLineLike): Decimal {
  if (!line.unitPrice) return new Decimal(0);
  return parseQtyDecimal(line.totalQty).mul(parseQtyDecimal(line.unitPrice));
}

/** Each item's RAB value: its BOQ need priced at the RAB unit price, plus its labour lines. */
export function itemValues(input: {
  items: Array<{ itemId: string; boq: BoqLike | null }>;
  rabLines: RabLineLike[];
  uomPlan: RabUomPlan;
}): ItemValue[] {
  const materialPrice = new Map<string, Decimal>();
  for (const l of input.rabLines) {
    if (isLabourLine(l) || !l.unitPrice) continue;
    materialPrice.set(l.key, parseQtyDecimal(l.unitPrice));
  }
  return input.items.map(({ itemId, boq }) => {
    let making = new Decimal(0);
    let install = new Decimal(0);
    for (const src of boq ? collectSourceLines([boq]) : []) {
      const target = resolveRabTarget(src.materialItemId, src.itemUomId, input.uomPlan);
      const price = materialPrice.get(target.key);
      if (!price) continue;
      const qty = parseQtyDecimal(src.qtyPerUnit)
        .mul(parseQtyDecimal(src.makeQty))
        .mul(target.factor);
      making = making.plus(qty.mul(price));
    }
    for (const l of input.rabLines) {
      if (!isLabourLine(l) || l.shopDrawingItemId !== itemId) continue;
      if (labourRole(l) === "install") install = install.plus(priceOf(l));
      else making = making.plus(priceOf(l));
    }
    return {
      itemId,
      makingValue: formatDecimal(making),
      installValue: formatDecimal(install),
    };
  });
}

/** Item bobot = item value ÷ Σ item values; install share = install ÷ item value. */
export function itemWeights(values: ItemValue[]): Map<string, ItemWeight> {
  const totals = values.map((v) => ({
    itemId: v.itemId,
    making: parseQtyDecimal(v.makingValue),
    install: parseQtyDecimal(v.installValue),
  }));
  const grand = totals.reduce((s, t) => s.plus(t.making).plus(t.install), new Decimal(0));
  const out = new Map<string, ItemWeight>();
  for (const t of totals) {
    const value = t.making.plus(t.install);
    out.set(t.itemId, {
      weightPercent: grand.gt(0) ? value.div(grand).mul(100).toNumber() : 0,
      installSharePercent: value.gt(0) ? t.install.div(value).mul(100).toNumber() : 0,
      value: formatDecimal(value),
    });
  }
  return out;
}

// ---------- dates ----------

const DAY_MS = 86_400_000;

function dayNo(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / DAY_MS);
}

/** Share of a window done by the end of `asOf` (linear over calendar days), or null. */
export function windowFraction(
  start: string | null | undefined,
  finish: string | null | undefined,
  asOf: string,
): number | null {
  if (!start || !finish || finish < start) return null;
  if (asOf < start) return 0;
  if (asOf >= finish) return 1;
  return (dayNo(asOf) - dayNo(start) + 1) / (dayNo(finish) - dayNo(start) + 1);
}

export type SCurvePeriodRow = { index: number; start: string; end: string };

const MAX_PERIODS = 1500;

/** Periods from `from` through `to`: 7-day weeks counted from `from` (M1 = from..from+6), or days. */
export function buildPeriods(from: string, to: string, period: SCurvePeriod): SCurvePeriodRow[] {
  const step = period === "week" ? 7 : 1;
  const out: SCurvePeriodRow[] = [];
  let start = from;
  while (start <= to) {
    out.push({ index: out.length + 1, start, end: addJakartaDays(start, step - 1) });
    if (out.length > MAX_PERIODS) {
      throw new Error("Schedule range is too long for this period; use weeks");
    }
    start = addJakartaDays(start, step);
  }
  return out;
}

// ---------- planned ----------

export type SCurvePlanItem = {
  itemId: string;
  weightPercent: number;
  installSharePercent: number;
  makeStart?: string | null;
  makeFinish?: string | null;
  installStart?: string | null;
  installFinish?: string | null;
};

/** Item-level planned %, 0–100, at the end of `asOf`. A missing window counts 0. */
export function itemPlannedPctAt(item: SCurvePlanItem, asOf: string): number {
  const share = item.installSharePercent / 100;
  const make = windowFraction(item.makeStart, item.makeFinish, asOf) ?? 0;
  const install = windowFraction(item.installStart, item.installFinish, asOf) ?? 0;
  return ((1 - share) * make + share * install) * 100;
}

/** Project planned %, 0–100, at the end of `asOf`. */
export function plannedPctAt(items: SCurvePlanItem[], asOf: string): number {
  return items.reduce((s, it) => s + (it.weightPercent * itemPlannedPctAt(it, asOf)) / 100, 0);
}

// ---------- actual ----------

export type SCurveReport = { date: string; lineKey: string; qty: string };

export type SCurveActualItem = {
  itemId: string;
  weightPercent: number;
  installSharePercent: number;
  makeQty: string;
  lines: StageLine[];
  reports: SCurveReport[];
};

/** Item-level actual %, 0–100, from reports dated on or before `asOf`. */
export function itemActualPctAt(item: SCurveActualItem, asOf: string): number {
  const done = new Map<string, Decimal>();
  for (const r of item.reports) {
    if (r.date > asOf) continue;
    done.set(r.lineKey, (done.get(r.lineKey) ?? new Decimal(0)).plus(parseQtyDecimal(r.qty)));
  }
  const doneByLine = new Map([...done].map(([k, v]) => [k, formatDecimal(v)]));
  const share = item.installSharePercent / 100;
  const making = trackPercentExact(item.makeQty, item.lines, doneByLine, "making");
  const install = trackPercentExact(item.makeQty, item.lines, doneByLine, "install");
  return (1 - share) * making + share * install;
}

/** Actual dates from SPK reports: first report, and the day the item reached 100%. */
export function itemActualDates(
  item: SCurveActualItem,
  today: string,
): { actualStart: string | null; actualFinish: string | null } {
  const dates = [...new Set(item.reports.map((r) => r.date))]
    .filter((d) => d <= today)
    .sort();
  const actualStart = dates[0] ?? null;
  const actualFinish = dates.find((d) => itemActualPctAt(item, d) >= 99.995) ?? null;
  return { actualStart, actualFinish };
}

export function actualPctAt(items: SCurveActualItem[], asOf: string): number {
  return items.reduce((s, it) => s + (it.weightPercent * itemActualPctAt(it, asOf)) / 100, 0);
}

// ---------- warnings ----------

export function scheduleWarnings(input: {
  plannedStartDate: string | null;
  plannedFinishDate: string | null;
  items: Array<SCurvePlanItem & { label: string }>;
}): string[] {
  const out: string[] = [];
  const { plannedStartDate: start, plannedFinishDate: finish } = input;
  if (!start || !finish) out.push("Set the project planned start and finish dates");
  for (const it of input.items) {
    if (it.weightPercent <= 0) {
      out.push(`${it.label} has no RAB value, so it weighs 0%`);
      continue;
    }
    if (!it.makeStart || !it.makeFinish) {
      out.push(`${it.label} has no making window`);
    }
    if (it.installSharePercent > 0 && (!it.installStart || !it.installFinish)) {
      out.push(`${it.label} has install labour but no install window`);
    }
    const dates = [it.makeStart, it.makeFinish, it.installStart, it.installFinish].filter(
      (d): d is string => !!d,
    );
    if (start && finish && dates.some((d) => d < start || d > finish)) {
      out.push(`${it.label} is planned outside the project dates`);
    }
  }
  return out;
}

// ---------- the curve ----------

const r2 = (n: number): number => Math.round(n * 100) / 100;

function windowDates(items: SCurvePlanItem[]): string[] {
  return items.flatMap((it) =>
    [it.makeStart, it.makeFinish, it.installStart, it.installFinish].filter(
      (d): d is string => !!d,
    ),
  );
}

export type SCurveInput = {
  period: SCurvePeriod;
  today: string;
  plannedStartDate: string | null;
  plannedFinishDate: string | null;
  current: Array<SCurvePlanItem & { label: string }>;
  baseline: {
    plannedStartDate: string;
    plannedFinishDate: string;
    items: SCurvePlanItem[];
  } | null;
  actual: SCurveActualItem[];
};

export type SCurveResult = Pick<
  ProjectSCurveOutDto,
  "today" | "items" | "points" | "warnings"
>;

export function buildSCurve(input: SCurveInput): SCurveResult {
  const warnings = scheduleWarnings({
    plannedStartDate: input.plannedStartDate,
    plannedFinishDate: input.plannedFinishDate,
    items: input.current,
  });
  const reportDates = input.actual.flatMap((a) => a.reports.map((r) => r.date));
  const dates = [
    input.plannedStartDate,
    input.plannedFinishDate,
    input.baseline?.plannedStartDate,
    input.baseline?.plannedFinishDate,
    ...windowDates(input.current),
    ...windowDates(input.baseline?.items ?? []),
    ...reportDates,
  ].filter((d): d is string => !!d);

  const from = input.plannedStartDate ?? dates.reduce<string | null>((m, d) => (!m || d < m ? d : m), null);
  const to = dates.reduce<string | null>((m, d) => (!m || d > m ? d : m), null);
  const periods = from && to && from <= to ? buildPeriods(from, to, input.period) : [];

  const planAt = (asOf: string) => plannedPctAt(input.current, asOf);
  const baseAt = (asOf: string) =>
    input.baseline ? plannedPctAt(input.baseline.items, asOf) : null;
  const actAt = (asOf: string) => actualPctAt(input.actual, asOf);

  const points: ProjectSCurvePointOutDto[] = [];
  let prevPlan = 0;
  let prevAct = 0;
  for (const p of periods) {
    const planned = planAt(p.end);
    const baseline = baseAt(p.end);
    const started = p.start <= input.today;
    const actual = started ? actAt(p.end < input.today ? p.end : input.today) : null;
    points.push({
      periodIndex: p.index,
      periodStart: p.start,
      periodEnd: p.end,
      baselinePct: baseline === null ? null : r2(baseline),
      plannedPct: r2(planned),
      actualPct: actual === null ? null : r2(actual),
      plannedDeltaPct: r2(planned - prevPlan),
      actualDeltaPct: actual === null ? null : r2(actual - prevAct),
    });
    prevPlan = planned;
    if (actual !== null) prevAct = actual;
  }

  const actualById = new Map(input.actual.map((a) => [a.itemId, a]));
  const items: ProjectSCurveItemOutDto[] = input.current.map((it) => {
    let prev = 0;
    const plannedByPeriod = periods.map((p) => {
      const at = (it.weightPercent * itemPlannedPctAt(it, p.end)) / 100;
      const delta = at - prev;
      prev = at;
      return r2(delta);
    });
    const act = actualById.get(it.itemId);
    return {
      itemId: it.itemId,
      label: it.label,
      weightPercent: r2(it.weightPercent),
      plannedByPeriod,
      plannedPct: r2(itemPlannedPctAt(it, input.today)),
      actualPct: act ? r2(itemActualPctAt(act, input.today)) : 0,
      ...(act
        ? itemActualDates(act, input.today)
        : { actualStart: null, actualFinish: null }),
    };
  });

  const todayPeriod = periods.find((p) => p.start <= input.today && input.today <= p.end);
  const plannedToday = planAt(input.today);
  const actualToday = actAt(input.today);
  const baseToday = baseAt(input.today);
  return {
    today: {
      ymd: input.today,
      periodIndex: todayPeriod?.index ?? null,
      plannedPct: r2(plannedToday),
      baselinePct: baseToday === null ? null : r2(baseToday),
      actualPct: r2(actualToday),
      deviationPct: r2(actualToday - plannedToday),
    },
    items,
    points,
    warnings,
  };
}

// ---------- calendar ----------

function jakartaIso(ymd: string, hm: string): string {
  return new Date(`${ymd}T${hm}:00+07:00`).toISOString();
}

/** Read-only calendar events for a project's schedule: project dates + item windows. */
export function scheduleCalendarEvents(input: {
  projectId: string;
  plannedStartDate?: string | null;
  plannedFinishDate?: string | null;
  items: Array<{
    itemId: string;
    label: string;
    makeStart?: string | null;
    makeFinish?: string | null;
    installStart?: string | null;
    installFinish?: string | null;
  }>;
}): ProjectCalendarEventOutDto[] {
  const out: ProjectCalendarEventOutDto[] = [];
  const base = {
    projectId: input.projectId,
    notes: "From the project schedule",
    source: "schedule" as const,
  };
  const deadline = (key: string, title: string, ymd: string | null | undefined) => {
    if (!ymd) return;
    out.push({
      ...base,
      id: `schedule:${key}`,
      type: "deadline",
      title,
      startAt: jakartaIso(ymd, "12:00"),
      endAt: null,
      shopDrawingItemId: null,
    });
  };
  deadline("start", "Project start (plan)", input.plannedStartDate);
  deadline("finish", "Project finish (plan)", input.plannedFinishDate);
  for (const it of input.items) {
    const windows: Array<[string, string, string | null | undefined, string | null | undefined]> = [
      ["make", "Making", it.makeStart, it.makeFinish],
      ["install", "Install", it.installStart, it.installFinish],
    ];
    for (const [phase, name, start, finish] of windows) {
      if (!start || !finish || finish < start) continue;
      out.push({
        ...base,
        id: `schedule:${it.itemId}:${phase}`,
        type: "range",
        title: `${name} · ${it.label}`,
        startAt: jakartaIso(start, "08:00"),
        endAt: jakartaIso(finish, "17:00"),
        shopDrawingItemId: it.itemId,
      });
    }
  }
  return out;
}
