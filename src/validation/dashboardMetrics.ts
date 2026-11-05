import type { SaveDashboardMetricsInDto } from "../dto/dashboardMetrics.dto";
import { asRecord } from "./asRecord";

/** Dashboard and metric ids: lowercase words joined by dashes, e.g. `late-projects`. */
const ID_RE = /^[a-z][a-z0-9-]{0,47}$/;
const MAX_METRICS = 50;

export function parseDashboardKey(raw: unknown): string {
  if (typeof raw !== "string" || !ID_RE.test(raw)) {
    throw new Error("Invalid dashboard");
  }
  return raw;
}

export function parseSaveDashboardMetricsDto(
  dashboard: unknown,
  body: unknown,
): SaveDashboardMetricsInDto {
  const row = asRecord(body);
  if (!Array.isArray(row.metrics)) throw new Error("metrics must be an array");
  if (row.metrics.length > MAX_METRICS) throw new Error("Too many metrics");
  const metrics: string[] = [];
  for (const m of row.metrics) {
    if (typeof m !== "string" || !ID_RE.test(m)) throw new Error("Invalid metric id");
    if (!metrics.includes(m)) metrics.push(m);
  }
  return { dashboard: parseDashboardKey(dashboard), metrics };
}
