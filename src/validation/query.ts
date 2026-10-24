/** Normalize an Express query/param value to a single trimmed string. */
export function queryString(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  return raw.trim() || undefined;
}

/** Normalize a path/query value to a string, defaulting to "". */
export function pathString(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : "";
}

/** Normalize a flag query value: "true", "1", or "yes". */
export function queryBool(value: unknown): boolean {
  const raw = queryString(value);
  return raw === "true" || raw === "1" || raw === "yes";
}
