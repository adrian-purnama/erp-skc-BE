import Decimal from "decimal.js";
import { Types } from "mongoose";
import type {
  CancelProductionOrderInDto,
  CompleteProductionOrderInDto,
  CreateProductionOrderInDto,
  CreateProductionReportInDto,
  ProductionHandoverCheckDto,
  ProductionOrderStatusDto,
  SaveMaterialDispatchInDto,
  SaveProductionHandoverInDto,
  UpdateProductionOrderInDto,
  VoidProductionHandoverInDto,
  VoidProductionReportInDto,
} from "../dto/production.dto";
import { PRODUCTION_ORDER_STATUSES } from "../models/productionOrder.model";
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
  let stageSequence: number | undefined;
  if (row.stageSequence !== undefined && row.stageSequence !== null) {
    const n =
      typeof row.stageSequence === "number"
        ? row.stageSequence
        : typeof row.stageSequence === "string"
          ? Number(row.stageSequence.trim())
          : NaN;
    if (!Number.isInteger(n) || n < 1) {
      throw new Error("stageSequence must be a positive integer");
    }
    stageSequence = n;
  }
  return {
    qtyDone: parseProductionQty(row.qtyDone, "qtyDone"),
    reportDate: parseRequiredYmd(row.reportDate, "reportDate"),
    notes: parseText(row.notes, "notes", NOTES_MAX),
    ...(stageSequence !== undefined ? { stageSequence } : {}),
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

const CHECKLIST_MAX = 30;
const LABEL_MAX = 120;

function parseChecklist(raw: unknown): ProductionHandoverCheckDto[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("checklist must be a list");
  if (raw.length > CHECKLIST_MAX) {
    throw new Error(`checklist can have at most ${CHECKLIST_MAX} rows`);
  }
  return raw.map((entry, i) => {
    const row = asRecord(entry);
    const label = parseText(row.label, `checklist[${i}].label`, LABEL_MAX);
    if (!label) throw new Error(`checklist[${i}].label is required`);
    const result = row.result;
    if (result !== null && result !== undefined && result !== "ok" && result !== "not_ok") {
      throw new Error(`checklist[${i}].result must be ok, not_ok or null`);
    }
    return {
      label,
      result: result ?? null,
      note: parseText(row.note, `checklist[${i}].note`, REASON_MAX),
    };
  });
}

export function parseSaveProductionHandoverDto(
  body: unknown,
): SaveProductionHandoverInDto {
  const row = asRecord(body);
  return {
    handoverDate: parseRequiredYmd(row.handoverDate, "handoverDate"),
    qty: parseProductionQty(row.qty),
    deliveryNoteNumber: parseText(row.deliveryNoteNumber, "deliveryNoteNumber", 100),
    receivedByUserId: parseOptionalUserId(row.receivedByUserId, "receivedByUserId"),
    notes: parseText(row.notes, "notes", NOTES_MAX),
    checklist: parseChecklist(row.checklist),
  };
}

export function parseVoidProductionHandoverDto(
  body: unknown,
): VoidProductionHandoverInDto {
  return { reason: parseReason(asRecord(body).reason, "reason") };
}

const DISPATCH_LINES_MAX = 100;

/** Qty ≥ 0 (zero lines are dropped by the dispatch rules). */
function parseDispatchQty(raw: unknown, field: string): string {
  const text = typeof raw === "number" ? String(raw) : raw;
  if (text === undefined || text === null || text === "") return "0";
  if (typeof text !== "string") throw new Error(`${field} must be a number`);
  let d: Decimal;
  try {
    d = new Decimal(text.trim());
  } catch {
    throw new Error(`${field} must be a number`);
  }
  if (!d.isFinite() || d.lt(0)) throw new Error(`${field} cannot be negative`);
  return formatDecimal(d);
}

export function parseSaveMaterialDispatchDto(body: unknown): SaveMaterialDispatchInDto {
  const row = asRecord(body);
  if (!Array.isArray(row.lines)) throw new Error("lines must be a list");
  if (row.lines.length > DISPATCH_LINES_MAX) throw new Error(`At most ${DISPATCH_LINES_MAX} lines`);
  return {
    dispatchDate: parseRequiredYmd(row.dispatchDate, "dispatchDate"),
    lines: row.lines.map((raw, i) => {
      const line = asRecord(raw);
      return {
        materialItemId: parseObjectId(line.materialItemId, `lines[${i}].materialItemId`),
        itemUomId: parseObjectId(line.itemUomId, `lines[${i}].itemUomId`),
        qty: parseDispatchQty(line.qty, `lines[${i}].qty`),
      };
    }),
    notes: parseText(row.notes, "notes", NOTES_MAX),
    receivedByName: parseText(row.receivedByName, "receivedByName", 120),
  };
}

export function parseSendMaterialDispatchDto(body: unknown): { dispatchDate: string; receivedByName: string } {
  const row = asRecord(body);
  return {
    dispatchDate: parseRequiredYmd(row.dispatchDate, "dispatchDate"),
    receivedByName: parseText(row.receivedByName, "receivedByName", 120),
  };
}
