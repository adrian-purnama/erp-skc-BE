import { Types } from "mongoose";
import {
  type AuditAction,
  getAuditModel,
  listAuditedCollections,
} from "../../../core/audit/auditedModel";
import type {
  AuditCollectionOutDto,
  AuditEventOutDto,
  AuditListOutDto,
} from "../../../dto/audit.dto";
import { UserModel } from "../../../models/user.model";
import { escapeRegex, userEmailsById } from "../../../utils/shared";
import type { AuditListQuery } from "../../../validation/audit";

const LABEL_KEYS = [
  "name",
  "projectNumber",
  "originalName",
  "filename",
  "title",
  "code",
  "email",
  "key",
] as const;

function humanizeModelName(modelName: string): string {
  return modelName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

function jsonSafe(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Types.ObjectId) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonSafe(v);
    }
    return out;
  }
  return value;
}

function snapshotLabel(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const doc = snapshot as Record<string, unknown>;
  for (const key of LABEL_KEYS) {
    const v = doc[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function changedKeys(before: unknown, after: unknown): string[] | undefined {
  if (
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object"
  ) {
    return undefined;
  }
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (key === "__v") continue;
    if (JSON.stringify(jsonSafe(a[key])) !== JSON.stringify(jsonSafe(b[key]))) {
      changed.push(key);
    }
  }
  return changed;
}

function buildSummary(
  action: AuditAction,
  before: unknown,
  after: unknown,
): AuditEventOutDto["summary"] {
  const label = snapshotLabel(after) ?? snapshotLabel(before);
  if (action === "A") return { label, changedKeys: undefined };
  if (action === "D") return { label, changedKeys: undefined };
  return { label, changedKeys: changedKeys(before, after) };
}

type LeanAudit = {
  _id: Types.ObjectId;
  refId: Types.ObjectId;
  action: AuditAction;
  before: unknown;
  after: unknown;
  by?: Types.ObjectId;
  at: Date;
};

export class AuditService {
  listCollections(): AuditCollectionOutDto[] {
    return listAuditedCollections()
      .map((c) => ({
        key: c.sourceCollection,
        label: humanizeModelName(c.modelName),
        auditCollection: c.auditCollection,
        modelName: c.modelName,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private resolveCollection(sourceCollection: string) {
    const info = getAuditModel(sourceCollection);
    if (!info) {
      throw new Error(`Unknown audit collection: ${sourceCollection}`);
    }
    return info;
  }

  private async resolveActors(
    ids: Types.ObjectId[],
  ): Promise<Map<string, { id: string; email: string }>> {
    const emails = await userEmailsById(ids);
    const map = new Map<string, { id: string; email: string }>();
    for (const [id, email] of emails) {
      map.set(id, { id, email });
    }
    return map;
  }

  private toOut(
    row: LeanAudit,
    actors: Map<string, { id: string; email: string }>,
  ): AuditEventOutDto {
    const byId = row.by?.toString();
    return {
      id: row._id.toString(),
      refId: row.refId.toString(),
      action: row.action,
      at: row.at.toISOString(),
      by: byId ? (actors.get(byId) ?? { id: byId, email: byId }) : null,
      summary: buildSummary(row.action, row.before, row.after),
      before: jsonSafe(row.before),
      after: jsonSafe(row.after),
    };
  }

  async list(
    sourceCollection: string,
    query: AuditListQuery,
  ): Promise<AuditListOutDto> {
    const { AuditModel } = this.resolveCollection(sourceCollection);

    const filter: Record<string, unknown> = {};
    if (query.action) filter.action = query.action;
    if (query.refId) filter.refId = new Types.ObjectId(query.refId);

    if (query.by) {
      filter.by = new Types.ObjectId(query.by);
    } else if (query.actorEmail) {
      const users = await UserModel.find({
        email: { $regex: escapeRegex(query.actorEmail), $options: "i" },
      })
        .select({ _id: 1 })
        .limit(50)
        .lean();
      if (users.length === 0) {
        return { items: [], total: 0, page: query.page, limit: query.limit };
      }
      filter.by = { $in: users.map((u) => u._id) };
    }

    if (query.from || query.to) {
      const at: Record<string, Date> = {};
      if (query.from) at.$gte = query.from;
      if (query.to) at.$lte = query.to;
      filter.at = at;
    }

    const skip = (query.page - 1) * query.limit;
    const [total, rows] = await Promise.all([
      AuditModel.countDocuments(filter),
      AuditModel.find(filter)
        .sort({ at: -1 })
        .skip(skip)
        .limit(query.limit)
        .lean<LeanAudit[]>(),
    ]);

    const actorIds = rows
      .map((r) => r.by)
      .filter((id): id is Types.ObjectId => id != null);
    const actors = await this.resolveActors(actorIds);

    return {
      items: rows.map((r) => this.toOut(r, actors)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async get(
    sourceCollection: string,
    id: string,
  ): Promise<AuditEventOutDto> {
    const { AuditModel } = this.resolveCollection(sourceCollection);
    if (!Types.ObjectId.isValid(id)) {
      throw new Error("Invalid audit id");
    }
    const row = await AuditModel.findById(id).lean<LeanAudit | null>();
    if (!row) {
      throw new Error("Audit event not found");
    }
    const actors = await this.resolveActors(row.by ? [row.by] : []);
    return this.toOut(row, actors);
  }
}

export const auditService = new AuditService();
