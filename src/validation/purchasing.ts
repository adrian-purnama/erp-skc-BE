import { Types } from "mongoose";
import type {
  CancelPurchaseRequestInDto,
  CreatePurchaseRequestInDto,
  PurchaseOrderLineInDto,
  PurchaseOrderStatusDto,
  PurchaseRequestLineInDto,
  PurchaseRequestStatusDto,
  PurchaseRealizationStatusDto,
  ReasonInDto,
  RealizationChargeInDto,
  SavePurchaseOrderInDto,
  SaveRealizationInDto,
  UpdatePurchaseRequestInDto,
} from "../dto/purchasing.dto";
import { PURCHASE_ORDER_STATUSES } from "../models/purchaseOrder/purchaseOrder.model";
import { PURCHASE_REALIZATION_STATUSES } from "../models/purchaseRealization/purchaseRealization.model";
import { PURCHASE_REQUEST_STATUSES } from "../models/purchaseRequest/purchaseRequest.model";
import { asRecord } from "./asRecord";
import { parseProductionQty } from "./production";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const NOTES_MAX = 2000;
const LINE_NOTE_MAX = 300;
const REASON_MAX = 500;
const LINES_MAX = 200;
const CHARGES_MAX = 20;

function parseObjectId(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !Types.ObjectId.isValid(raw)) {
    throw new Error(`${field} is required`);
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

function parseYmd(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !YMD.test(raw.trim())) {
    throw new Error(`${field} is required (YYYY-MM-DD)`);
  }
  return raw.trim();
}

function parseLine(raw: unknown, index: number): PurchaseRequestLineInDto {
  const row = asRecord(raw);
  const at = `lines[${index}]`;
  return {
    materialItemId: parseObjectId(row.materialItemId, `${at}.materialItemId`),
    itemUomId: parseObjectId(row.itemUomId, `${at}.itemUomId`),
    qty: parseProductionQty(row.qty, `${at}.qty`),
    note: parseText(row.note, `${at}.note`, LINE_NOTE_MAX),
  };
}

function parseLines(raw: unknown): PurchaseRequestLineInDto[] {
  if (!Array.isArray(raw)) throw new Error("lines must be a list");
  if (raw.length > LINES_MAX) throw new Error(`At most ${LINES_MAX} lines`);
  return raw.map(parseLine);
}

export function parseCreatePurchaseRequestDto(body: unknown): CreatePurchaseRequestInDto {
  const row = asRecord(body);
  return {
    projectId: parseObjectId(row.projectId, "projectId"),
    productionOrderId:
      row.productionOrderId === undefined || row.productionOrderId === null || row.productionOrderId === ""
        ? null
        : parseObjectId(row.productionOrderId, "productionOrderId"),
    neededDate: parseYmd(row.neededDate, "neededDate"),
    notes: parseText(row.notes, "notes", NOTES_MAX),
    lines: parseLines(row.lines),
  };
}

export function parseUpdatePurchaseRequestDto(body: unknown): UpdatePurchaseRequestInDto {
  const row = asRecord(body);
  return {
    neededDate: parseYmd(row.neededDate, "neededDate"),
    notes: parseText(row.notes, "notes", NOTES_MAX),
    lines: parseLines(row.lines),
  };
}

export function parseCancelPurchaseRequestDto(body: unknown): CancelPurchaseRequestInDto {
  const reason = parseText(asRecord(body).reason, "reason", REASON_MAX);
  if (!reason) throw new Error("reason is required");
  return { reason };
}

export function parsePurchaseRequestStatusFilter(
  raw: string | undefined,
): PurchaseRequestStatusDto | undefined {
  if (!raw) return undefined;
  if (!(PURCHASE_REQUEST_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(`status must be one of: ${PURCHASE_REQUEST_STATUSES.join(", ")}`);
  }
  return raw as PurchaseRequestStatusDto;
}

/** Optional ObjectId from a query string. */
export function parseOptionalQueryId(raw: string | undefined, field: string): string | undefined {
  if (!raw) return undefined;
  if (!Types.ObjectId.isValid(raw)) throw new Error(`${field} is invalid`);
  return raw;
}

function parseOptionalYmd(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  return parseYmd(raw, field);
}

/** Positive whole rupiah as digits. */
function parseRupiah(raw: unknown, field: string): string {
  const text = typeof raw === "number" ? String(raw) : raw;
  if (typeof text !== "string" || !/^\d+$/.test(text.trim())) {
    throw new Error(`${field} must be a whole rupiah amount`);
  }
  return String(BigInt(text.trim()));
}

function parseOrderLine(raw: unknown, index: number): PurchaseOrderLineInDto {
  const row = asRecord(raw);
  const at = `lines[${index}]`;
  return {
    requestLineId: parseObjectId(row.requestLineId, `${at}.requestLineId`),
    qty: parseProductionQty(row.qty, `${at}.qty`),
    unitPrice: parseRupiah(row.unitPrice, `${at}.unitPrice`),
    note: parseText(row.note, `${at}.note`, LINE_NOTE_MAX),
  };
}

export function parseSavePurchaseOrderDto(body: unknown): SavePurchaseOrderInDto {
  const row = asRecord(body);
  if (!Array.isArray(row.lines)) throw new Error("lines must be a list");
  if (row.lines.length > LINES_MAX) throw new Error(`At most ${LINES_MAX} lines`);
  return {
    requestId: parseObjectId(row.requestId, "requestId"),
    vendorId: parseObjectId(row.vendorId, "vendorId"),
    termOfPaymentId:
      row.termOfPaymentId === undefined || row.termOfPaymentId === null || row.termOfPaymentId === ""
        ? null
        : parseObjectId(row.termOfPaymentId, "termOfPaymentId"),
    expectedDate: parseOptionalYmd(row.expectedDate, "expectedDate"),
    notes: parseText(row.notes, "notes", NOTES_MAX),
    lines: row.lines.map(parseOrderLine),
  };
}

export function parseReasonDto(body: unknown): ReasonInDto {
  const reason = parseText(asRecord(body).reason, "reason", REASON_MAX);
  if (!reason) throw new Error("reason is required");
  return { reason };
}

export function parsePurchaseOrderStatusFilter(
  raw: string | undefined,
): PurchaseOrderStatusDto | undefined {
  if (!raw) return undefined;
  if (!(PURCHASE_ORDER_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(`status must be one of: ${PURCHASE_ORDER_STATUSES.join(", ")}`);
  }
  return raw as PurchaseOrderStatusDto;
}

export function parseSaveRealizationDto(body: unknown): SaveRealizationInDto {
  const row = asRecord(body);
  if (row.method !== "vendor" && row.method !== "staff") {
    throw new Error("method must be vendor or staff");
  }
  if (!Array.isArray(row.lines)) throw new Error("lines must be a list");
  if (row.lines.length > LINES_MAX) throw new Error(`At most ${LINES_MAX} lines`);
  const buyerUserId =
    row.buyerUserId === undefined || row.buyerUserId === null || row.buyerUserId === ""
      ? null
      : parseObjectId(row.buyerUserId, "buyerUserId");
  if (row.method === "staff" && !buyerUserId) {
    throw new Error("Choose who bought it");
  }
  const charges = row.charges ?? [];
  if (!Array.isArray(charges)) throw new Error("charges must be a list");
  if (charges.length > CHARGES_MAX) throw new Error(`At most ${CHARGES_MAX} charges`);
  return {
    purchaseOrderId: parseObjectId(row.purchaseOrderId, "purchaseOrderId"),
    method: row.method,
    buyerUserId,
    purchaseDate: parseYmd(row.purchaseDate, "purchaseDate"),
    place: parseText(row.place, "place", 200),
    notaNumber: parseText(row.notaNumber, "notaNumber", 100),
    receivedByUserId:
      row.receivedByUserId === undefined || row.receivedByUserId === null || row.receivedByUserId === ""
        ? null
        : parseObjectId(row.receivedByUserId, "receivedByUserId"),
    deliveryNoteNumber: parseText(row.deliveryNoteNumber, "deliveryNoteNumber", 100),
    comments: parseText(row.comments, "comments", NOTES_MAX),
    lines: row.lines.map((raw, i) => {
      const line = asRecord(raw);
      const at = `lines[${i}]`;
      return {
        poLineId: parseObjectId(line.poLineId, `${at}.poLineId`),
        qty: parseProductionQty(line.qty, `${at}.qty`),
        unitPrice: parseRupiah(line.unitPrice, `${at}.unitPrice`),
        note: parseText(line.note, `${at}.note`, LINE_NOTE_MAX),
      };
    }),
    charges: charges.map(parseRealizationCharge),
  };
}

function parseRealizationCharge(raw: unknown, index: number): RealizationChargeInDto {
  const row = asRecord(raw);
  const at = `charges[${index}]`;
  const label = parseText(row.label, `${at}.label`, 100);
  if (!label) throw new Error(`${at}.label is required`);
  if (row.kind === "percent") {
    const rate = parseProductionQty(row.rate, `${at}.rate`);
    if (Number(rate) > 100) throw new Error(`${at}.rate must be at most 100`);
    return { label, kind: "percent", rate, amount: "0" };
  }
  if (row.kind === "fixed") {
    return { label, kind: "fixed", rate: null, amount: parseRupiah(row.amount, `${at}.amount`) };
  }
  throw new Error(`${at}.kind must be percent or fixed`);
}

export function parseRealizationStatusFilter(
  raw: string | undefined,
): PurchaseRealizationStatusDto | undefined {
  if (!raw) return undefined;
  if (!(PURCHASE_REALIZATION_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(`status must be one of: ${PURCHASE_REALIZATION_STATUSES.join(", ")}`);
  }
  return raw as PurchaseRealizationStatusDto;
}
