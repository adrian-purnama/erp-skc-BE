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

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

export const env = {
  port: Number(process.env.PORT) || 3000,
  build: build(),
  mongodbUrl: required("MONGODB_URL"),
  frontendUrl: required("FRONTEND_URL"),
  brevoApiKey: required("BREVO_API_KEY"),
  brevoSenderEmail: required("BREVO_SENDER_EMAIL"),
  jwtSecret: required("JWT_SECRET"),
  rbacScanStrict: process.env.RBAC_SCAN_STRICT !== "false",
  auditRequireReplicaSet: process.env.AUDIT_REQUIRE_REPLICA_SET !== "false",
  itemMasterMaxFolderDepth: positiveInt("ITEM_MASTER_MAX_FOLDER_DEPTH", 10),
};
