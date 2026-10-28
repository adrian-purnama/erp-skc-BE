import { randomBytes } from "node:crypto";

/** 256-bit random, URL-safe. */
export function newVerifyToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isVerifyTokenShape(raw: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(raw);
}

export type VerifyState = "valid" | "expired" | "superseded" | "unavailable";

/**
 * Whether the client page may show the quotation.
 * `validUntil` is inclusive and compared in Jakarta calendar days.
 */
export function verifyState(input: {
  status: "draft" | "issued" | "superseded" | "won";
  validUntil: string | null | undefined;
  todayYmd: string;
}): VerifyState {
  if (input.status === "superseded") return "superseded";
  if (input.status !== "issued" && input.status !== "won") return "unavailable";
  if (!input.validUntil || input.validUntil < input.todayYmd) return "expired";
  return "valid";
}
