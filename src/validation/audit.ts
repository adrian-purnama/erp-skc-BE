import { Types } from "mongoose";
import type { AuditAction } from "../core/audit/auditedModel";

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseAuditCollectionKey(
  param: string | string[] | undefined,
): string {
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    throw new Error("collection required");
  }
  const key = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    throw new Error("Invalid collection");
  }
  return key;
}

export type AuditListQuery = {
  action?: AuditAction;
  refId?: string;
  by?: string;
  actorEmail?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
};

export function parseAuditListQuery(
  query: Record<string, unknown>,
): AuditListQuery {
  const actionRaw = asString(query.action);
  let action: AuditAction | undefined;
  if (actionRaw) {
    if (actionRaw !== "A" && actionRaw !== "U" && actionRaw !== "D") {
      throw new Error("action must be A, U, or D");
    }
    action = actionRaw;
  }

  const refId = asString(query.refId);
  if (refId && !Types.ObjectId.isValid(refId)) {
    throw new Error("Invalid refId");
  }

  const by = asString(query.by);
  if (by && !Types.ObjectId.isValid(by)) {
    throw new Error("Invalid by");
  }

  const actorEmail = asString(query.actorEmail);

  const fromRaw = asString(query.from);
  const toRaw = asString(query.to);
  let from: Date | undefined;
  let to: Date | undefined;
  if (fromRaw) {
    from = new Date(fromRaw);
    if (Number.isNaN(from.getTime())) throw new Error("Invalid from date");
  }
  if (toRaw) {
    to = new Date(toRaw);
    if (Number.isNaN(to.getTime())) throw new Error("Invalid to date");
  }

  const pageRaw = asString(query.page) ?? "1";
  const limitRaw = asString(query.limit) ?? "25";
  const page = Number(pageRaw);
  const limit = Number(limitRaw);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("page must be a positive integer");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit must be between 1 and 100");
  }

  return { action, refId, by, actorEmail, from, to, page, limit };
}
