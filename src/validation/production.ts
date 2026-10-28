import Decimal from "decimal.js";
import { Types } from "mongoose";
import type {
  CancelProductionOrderInDto,
  CompleteProductionOrderInDto,
  CreateProductionOrderInDto,
  CreateProductionReportInDto,
  ProductionOrderStatusDto,
  UpdateProductionOrderInDto,
  VoidProductionReportInDto,
} from "../dto/production.dto";
import { PRODUCTION_ORDER_STATUSES } from "../models/productionOrder/productionOrder.model";
import { formatDecimal } from "../modules/itemMaster/itemUomConvert";
import { asRecord } from "./asRecord";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const NOTES_MAX = 2000;
const REASON_MAX = 500;

function parseObjectId(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !Types.ObjectId.isValid(raw)) {
    throw new Error(`${field} is required`);
  }
  return raw;
}

/** Positive decimal qty, returned in canonical form. */
export function parseProductionQty(raw: unknown, field = "qty"): string {
  const text = typeof raw === "number" ? String(raw) : raw;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error(`${field} is required`);
  }
  let d: Decimal;
  try {
    d = new Decimal(text.trim());
  } catch {
    throw new Error(`${field} must be a number`);
  }
  if (!d.isFinite() || d.lte(0)) {
    throw new Error(`${field} must be greater than 0`);
  }
  return formatDecimal(d);
}

function parseOptionalYmd(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !YMD.test(raw.trim())) {
    throw new Error(`${field} must be a date (YYYY-MM-DD)`);
  }
  return raw.trim();
}

function parseRequiredYmd(raw: unknown, field: string): string {
  const ymd = parseOptionalYmd(raw, field);
  if (!ymd) throw new Error(`${field} is required`);
  return ymd;
}

/** Missing / null / "" → null (no PIC). */
function parseOptionalUserId(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !Types.ObjectId.isValid(raw)) {
    throw new Error(`${field} must be a user id`);
  }
  return raw;
}

function parseText(raw: unknown, field: string, max: number): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") throw new Error(`${field} must be text`);
  const text = raw.trim();
  if (text.length > max) {
    throw new Error(`${field} must be at most ${max} characters`);
  }
  return text;
}

/** Notes are one item per line: trim each, drop empty lines. */
function parseNotes(raw: unknown): string {
  return parseText(raw, "notes", NOTES_MAX)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function parseReason(raw: unknown, field: string): string {
  const text = parseText(raw, field, REASON_MAX);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function assertDateOrder(start: string | null, finish: string | null): void {
  if (start && finish && finish < start) {
    throw new Error("plannedFinish cannot be before plannedStart");
  }
}

export function parseCreateProductionOrderDto(
  body: unknown,
): CreateProductionOrderInDto {
  const row = asRecord(body);
  const plannedStart = parseOptionalYmd(row.plannedStart, "plannedStart");
  const plannedFinish = parseOptionalYmd(row.plannedFinish, "plannedFinish");
  assertDateOrder(plannedStart, plannedFinish);
  return {
    projectId: parseObjectId(row.projectId, "projectId"),
    shopDrawingItemId: parseObjectId(row.shopDrawingItemId, "shopDrawingItemId"),
    qty: parseProductionQty(row.qty),
    plannedStart,
    plannedFinish,
    picUserId: parseOptionalUserId(row.picUserId, "picUserId"),
    notes: parseNotes(row.notes),
  };
}

export function parseUpdateProductionOrderDto(
  body: unknown,
): UpdateProductionOrderInDto {
  const row = asRecord(body);
  const out: UpdateProductionOrderInDto = {};
  if (row.qty !== undefined) out.qty = parseProductionQty(row.qty);
  if (row.plannedStart !== undefined) {
    out.plannedStart = parseOptionalYmd(row.plannedStart, "plannedStart");
  }
  if (row.plannedFinish !== undefined) {
    out.plannedFinish = parseOptionalYmd(row.plannedFinish, "plannedFinish");
  }
  if (out.plannedStart !== undefined && out.plannedFinish !== undefined) {
    assertDateOrder(out.plannedStart, out.plannedFinish);
  }
  if (row.picUserId !== undefined) {
    out.picUserId = parseOptionalUserId(row.picUserId, "picUserId");
  }
  if (row.notes !== undefined) {
    out.notes = parseNotes(row.notes);
  }
  return out;
}

export function parseCompleteProductionOrderDto(
  body: unknown,
): CompleteProductionOrderInDto {
  const row = body === undefined ? {} : asRecord(body);
  return { note: parseText(row.note, "note", REASON_MAX) };
}

export function parseCancelProductionOrderDto(
  body: unknown,
): CancelProductionOrderInDto {
  return { reason: parseReason(asRecord(body).reason, "reason") };
}

export function parseCreateProductionReportDto(
  body: unknown,
): CreateProductionReportInDto {
  const row = asRecord(body);
  return {
    qtyDone: parseProductionQty(row.qtyDone, "qtyDone"),
    reportDate: parseRequiredYmd(row.reportDate, "reportDate"),
    notes: parseText(row.notes, "notes", NOTES_MAX),
  };
}

export function parseVoidProductionReportDto(
  body: unknown,
): VoidProductionReportInDto {
  return { reason: parseReason(asRecord(body).reason, "reason") };
}

export function parseProductionOrderStatusFilter(
  raw: string | undefined,
): ProductionOrderStatusDto | undefined {
  if (!raw) return undefined;
  if (!(PRODUCTION_ORDER_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(
      `status must be one of: ${PRODUCTION_ORDER_STATUSES.join(", ")}`,
    );
  }
  return raw as ProductionOrderStatusDto;
}
