/** Calendar helpers in the company's time zone (Asia/Jakarta, UTC+7). */

export const JAKARTA_TZ = "Asia/Jakarta";

const jakartaPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: JAKARTA_TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

export type JakartaYmdParts = {
  year: number;
  month: number;
  day: number;
};

export function jakartaYmdParts(now: Date = new Date()): JakartaYmdParts {
  const parts = jakartaPartsFormatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error("Failed to resolve Jakarta calendar date");
  }
  return { year, month, day };
}

export function jakartaYmdString(now: Date = new Date()): string {
  const { year, month, day } = jakartaYmdParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addJakartaDays(ymd: string, days: number): string {
  const [y, m, day] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, day + days));
  return utc.toISOString().slice(0, 10);
}
