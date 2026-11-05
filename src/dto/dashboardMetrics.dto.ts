/**
 * Metrics a user shows on each dashboard, in order: `{ project: ["active-projects", …] }`.
 * A dashboard missing from the map has never been customized (the app shows its defaults).
 */
export type DashboardMetricsOutDto = Record<string, string[]>;

export type SaveDashboardMetricsInDto = {
  dashboard: string;
  /** Metric ids, in display order. Empty = show nothing. */
  metrics: string[];
};
