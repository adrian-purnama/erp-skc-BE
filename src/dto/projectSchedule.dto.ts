/** Planned windows of one item; dates are YYYY-MM-DD (Jakarta) or null. */
export type ProjectScheduleWindowsDto = {
  makeStart: string | null;
  makeFinish: string | null;
  installStart: string | null;
  installFinish: string | null;
};

export type ProjectScheduleItemOutDto = ProjectScheduleWindowsDto & {
  itemId: string;
  label: string;
  /** Item bobot from RAB value, 0–100 (2 dp). */
  weightPercent: number;
  /** Install share inside the item, 0–100 (2 dp). 0 = no install labour. */
  installSharePercent: number;
  /** Item RAB value (IDR digits) the weight comes from. */
  value: string;
};

export type ProjectScheduleOutDto = {
  projectId: string;
  plannedStartDate: string | null;
  plannedFinishDate: string | null;
  items: ProjectScheduleItemOutDto[];
  baseline: {
    setAt: string;
    plannedStartDate: string;
    plannedFinishDate: string;
  } | null;
  warnings: string[];
};

export type SaveProjectScheduleDto = {
  plannedStartDate: string | null;
  plannedFinishDate: string | null;
  items: Array<ProjectScheduleWindowsDto & { itemId: string }>;
};

export const S_CURVE_PERIODS = ["week", "day"] as const;
export type SCurvePeriod = (typeof S_CURVE_PERIODS)[number];

export type ProjectSCurvePointOutDto = {
  /** 1-based: M1, M2, … (week) or day number. */
  periodIndex: number;
  periodStart: string;
  periodEnd: string;
  /** Cumulative %, 2 dp. Null when there is no baseline. */
  baselinePct: number | null;
  plannedPct: number;
  /** Cumulative %, 2 dp. Null for periods that start after today. */
  actualPct: number | null;
  /** This period only. */
  plannedDeltaPct: number;
  actualDeltaPct: number | null;
};

export type ProjectSCurveItemOutDto = {
  itemId: string;
  label: string;
  weightPercent: number;
  /** Planned bobot per period (project %), aligned with `points`. */
  plannedByPeriod: number[];
  /** Item-level %, 0–100, as of today. */
  plannedPct: number;
  actualPct: number;
  /** First SPK report date (YYYY-MM-DD), or null. */
  actualStart: string | null;
  /** Date the item reached 100% from SPK reports, or null while unfinished. */
  actualFinish: string | null;
};

export type ProjectSCurveOutDto = {
  projectId: string;
  period: SCurvePeriod;
  plannedStartDate: string | null;
  plannedFinishDate: string | null;
  baselineSetAt: string | null;
  today: {
    ymd: string;
    periodIndex: number | null;
    plannedPct: number;
    baselinePct: number | null;
    actualPct: number;
    /** actual − planned. */
    deviationPct: number;
  };
  items: ProjectSCurveItemOutDto[];
  points: ProjectSCurvePointOutDto[];
  warnings: string[];
};
