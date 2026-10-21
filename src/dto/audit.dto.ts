import type { AuditAction } from "../core/audit/auditedModel";

export type AuditCollectionOutDto = {
  key: string;
  label: string;
  auditCollection: string;
  modelName: string;
};

export type AuditActorOutDto = {
  id: string;
  email: string;
};

export type AuditSummaryOutDto = {
  label?: string;
  changedKeys?: string[];
};

export type AuditEventOutDto = {
  id: string;
  refId: string;
  action: AuditAction;
  at: string;
  by: AuditActorOutDto | null;
  summary: AuditSummaryOutDto;
  before: unknown;
  after: unknown;
};

export type AuditListOutDto = {
  items: AuditEventOutDto[];
  total: number;
  page: number;
  limit: number;
};
