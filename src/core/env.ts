function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function build(): string {
  const raw = process.env.BUILD;
  if (!raw) return "development";
  if (
    raw === "development" ||
    raw === "DEVELOPMENT" ||
    raw === "dev" ||
    raw === "DEV"
  ) {
    return "development";
  }
  return raw;
}

/** Comma-separated origins, e.g. "https://a.com,https://www.a.com". */
function origins(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

/** A `jsonwebtoken` / `ms` duration such as "1d", "12h" or "30d". */
export type DurationString = `${number}${"s" | "m" | "h" | "d" | "w" | "y"}`;

function duration(name: string, fallback: DurationString): DurationString {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9]\d*[smhdwy]$/.test(raw)) {
    throw new Error(`${name} must be a duration like "12h" or "30d"`);
  }
  return raw as DurationString;
}

export const env = {
  port: Number(process.env.PORT) || 3000,
  build: build(),
  mongodbUrl: required("MONGODB_URL"),
  frontendUrl: required("FRONTEND_URL"),
  /** Public website origins allowed by CORS (quote form). Optional, comma-separated. */
  landingUrls: origins("LANDING_URL"),
  /** Public base URL of this API (e.g. https://api.example.com); used for absolute asset links in emails. */
  publicApiUrl: process.env.PUBLIC_API_URL?.trim() || null,
  brevoApiKey: required("BREVO_API_KEY"),
  brevoSenderEmail: required("BREVO_SENDER_EMAIL"),
  jwtSecret: required("JWT_SECRET"),
  /** Login session lifetime without "Remember me". */
  sessionTtl: duration("SESSION_TTL", "1d"),
  /** Login session lifetime with "Remember me" checked. */
  sessionTtlRememberMe: duration("SESSION_TTL_REMEMBER_ME", "30d"),
  rbacScanStrict: process.env.RBAC_SCAN_STRICT !== "false",
  auditRequireReplicaSet: process.env.AUDIT_REQUIRE_REPLICA_SET !== "false",
  itemMasterMaxFolderDepth: positiveInt("ITEM_MASTER_MAX_FOLDER_DEPTH", 10),
};
