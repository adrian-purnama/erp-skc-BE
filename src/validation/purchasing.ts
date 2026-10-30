import { Types } from "mongoose";
import type {
  CancelPurchaseRequestInDto,
  CreatePurchaseRequestInDto,
  PayPurchasePaymentInDto,
  PurchasePaymentKindDto,
  PurchasePaymentStatusDto,
  PurchaseOrderLineInDto,
  PurchaseOrderStatusDto,
  PurchaseRabLineInDto,
  PurchaseRabStatusDto,
  PurchaseRequestLineInDto,
  PurchaseRequestStatusDto,
  PurchaseRealizationStatusDto,
  ReasonInDto,
  RealizationChargeInDto,
  SavePurchaseOrdersInDto,
  SavePurchaseRabInDto,
  SaveRealizationInDto,
  SaveReimbursementInDto,
  SaveVendorPaymentInDto,
  UpdatePurchaseRequestInDto,
} from "../dto/purchasing.dto";
import { PURCHASE_ORDER_STATUSES } from "../models/purchaseOrder.model";
import {
  PURCHASE_PAYMENT_KINDS,
  PURCHASE_PAYMENT_METHODS,
  PURCHASE_PAYMENT_STAGES,
  PURCHASE_PAYMENT_STATUSES,
} from "../models/purchasePayment.model";
import { PURCHASE_RAB_STATUSES } from "../models/purchaseRab.model";
import { PURCHASE_REALIZATION_STATUSES } from "../models/purchaseRealization.model";
import { PURCHASE_REQUEST_STATUSES } from "../models/purchaseRequest.model";
import { asRecord } from "./asRecord";
import { parseProductionQty } from "./production";
import {
  CHARGE_CATEGORIES,
  inferChargeCategory,
  type ChargeCategory,
} from "../modules/purchasing/purchaseRealization.planner";

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

function parseOptionalId(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  return parseObjectId(raw, field);
}

export function parseCreatePurchaseRequestDto(body: unknown): CreatePurchaseRequestInDto {
  const row = asRecord(body);
  const productionOrderId = parseOptionalId(row.productionOrderId, "productionOrderId");
  const purchaseRabId = parseOptionalId(row.purchaseRabId, "purchaseRabId");
  if (!productionOrderId === !purchaseRabId) {
    throw new Error("Choose either an SPK or a RAB");
  }
  return {
    productionOrderId,
    purchaseRabId,
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

export function parseSavePurchaseOrdersDto(body: unknown): SavePurchaseOrdersInDto {
  const row = asRecord(body);
  if (!Array.isArray(row.lines)) throw new Error("lines must be a list");
  if (row.lines.length > LINES_MAX) throw new Error(`At most ${LINES_MAX} lines`);
  const terms = row.terms ?? [];
  if (!Array.isArray(terms)) throw new Error("terms must be a list");
  return {
    requestId: parseObjectId(row.requestId, "requestId"),
    expectedDate: parseOptionalYmd(row.expectedDate, "expectedDate"),
    notes: parseText(row.notes, "notes", NOTES_MAX),
    approver1Id: parseObjectId(row.approver1Id, "approver1Id"),
    approver2Id: parseObjectId(row.approver2Id, "approver2Id"),
    terms: terms.map((raw, i) => {
      const t = asRecord(raw);
      return {
        vendorId: parseObjectId(t.vendorId, `terms[${i}].vendorId`),
        termOfPaymentId:
          t.termOfPaymentId === undefined || t.termOfPaymentId === null || t.termOfPaymentId === ""
            ? null
            : parseObjectId(t.termOfPaymentId, `terms[${i}].termOfPaymentId`),
      };
    }),
    lines: row.lines.map((raw, i) => ({
      ...parseOrderLine(raw, i),
      vendorId: parseObjectId(asRecord(raw).vendorId, `lines[${i}].vendorId`),
    })),
    submit: row.submit === true,
  };
}

export function parseApprovalLevel(raw: string | undefined): 1 | 2 {
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  throw new Error("level must be 1 or 2");
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
    deliveredTo: row.deliveredTo === "vendor" ? "vendor" : "us",
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
    charges: parseChargeList(row.charges),
  };
}

/** Tax / delivery / other charges (realization, PO estimate, RAB budget); absent = none. */
export function parseChargeList(raw: unknown): RealizationChargeInDto[] {
  const charges = raw ?? [];
  if (!Array.isArray(charges)) throw new Error("charges must be a list");
  if (charges.length > CHARGES_MAX) throw new Error(`At most ${CHARGES_MAX} charges`);
  return charges.map(parseRealizationCharge);
}

function parseRealizationCharge(raw: unknown, index: number): RealizationChargeInDto {
  const row = asRecord(raw);
  const at = `charges[${index}]`;
  const label = parseText(row.label, `${at}.label`, 100);
  if (!label) throw new Error(`${at}.label is required`);
  // Older clients send no category: take it from the name.
  let category = inferChargeCategory(label);
  if (row.category !== undefined && row.category !== null && row.category !== "") {
    if (!(CHARGE_CATEGORIES as readonly unknown[]).includes(row.category)) {
      throw new Error(`${at}.category must be one of: ${CHARGE_CATEGORIES.join(", ")}`);
    }
    category = row.category as ChargeCategory;
  }
  if (row.kind === "percent") {
    const rate = parseProductionQty(row.rate, `${at}.rate`);
    if (Number(rate) > 100) throw new Error(`${at}.rate must be at most 100`);
    return { category, label, kind: "percent", rate, amount: "0" };
  }
  if (row.kind === "fixed") {
    return { category, label, kind: "fixed", rate: null, amount: parseRupiah(row.amount, `${at}.amount`) };
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

const RAB_TITLE_MAX = 200;

function parseRabLine(raw: unknown, index: number): PurchaseRabLineInDto {
  const row = asRecord(raw);
  const at = `lines[${index}]`;
  return {
    materialItemId: parseObjectId(row.materialItemId, `${at}.materialItemId`),
    itemUomId: parseObjectId(row.itemUomId, `${at}.itemUomId`),
    qty: parseProductionQty(row.qty, `${at}.qty`),
    unitPrice: parseRupiah(row.unitPrice, `${at}.unitPrice`),
    note: parseText(row.note, `${at}.note`, LINE_NOTE_MAX),
  };
}

export function parseSavePurchaseRabDto(body: unknown): SavePurchaseRabInDto {
  const row = asRecord(body);
  const title = parseText(row.title, "title", RAB_TITLE_MAX);
  if (!title) throw new Error("title is required");
  if (!Array.isArray(row.lines)) throw new Error("lines must be a list");
  if (row.lines.length > LINES_MAX) throw new Error(`At most ${LINES_MAX} lines`);
  return {
    title,
    notes: parseText(row.notes, "notes", NOTES_MAX),
    lines: row.lines.map(parseRabLine),
    charges: parseChargeList(row.charges),
  };
}

export function parsePurchaseRabStatusFilter(raw: string | undefined): PurchaseRabStatusDto | undefined {
  if (!raw) return undefined;
  if (!(PURCHASE_RAB_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(`status must be one of: ${PURCHASE_RAB_STATUSES.join(", ")}`);
  }
  return raw as PurchaseRabStatusDto;
}

// ---- Payments ----

const PAYMENT_IDS_MAX = 100;

function parseIdList(raw: unknown, field: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`${field} must be a list`);
  if (raw.length > PAYMENT_IDS_MAX) throw new Error(`${field} can have at most ${PAYMENT_IDS_MAX} entries`);
  const ids = raw.map((id, i) => parseObjectId(id, `${field}[${i}]`));
  return [...new Set(ids)];
}

function parseRate(raw: unknown): string {
  const text = typeof raw === "number" ? String(raw) : raw;
  if (typeof text !== "string" || !/^\d{1,3}(\.\d{1,4})?$/.test(text.trim())) {
    throw new Error("rate must be a percent (e.g. 30 or 12.5)");
  }
  const n = Number(text.trim());
  if (n <= 0 || n > 100) throw new Error("rate must be more than 0 and at most 100");
  return String(n);
}

export function parseSaveVendorPaymentDto(body: unknown): SaveVendorPaymentInDto {
  const row = asRecord(body);
  const stage = row.stage;
  if (typeof stage !== "string" || !(PURCHASE_PAYMENT_STAGES as readonly string[]).includes(stage)) {
    throw new Error(`stage must be one of: ${PURCHASE_PAYMENT_STAGES.join(", ")}`);
  }
  const pelunasan = stage === "pelunasan";
  const basis = pelunasan ? null : row.basis;
  if (!pelunasan && basis !== "percent" && basis !== "fixed") {
    throw new Error("basis must be percent or fixed");
  }
  return {
    purchaseOrderId: parseObjectId(row.purchaseOrderId, "purchaseOrderId"),
    stage: stage as SaveVendorPaymentInDto["stage"],
    basis: basis as SaveVendorPaymentInDto["basis"],
    rate: basis === "percent" ? parseRate(row.rate) : null,
    amount: basis === "fixed" ? parseRupiah(row.amount, "amount") : "0",
    dueDate: parseOptionalYmd(row.dueDate, "dueDate"),
    notes: parseText(row.notes, "notes", NOTES_MAX),
    realizationIds: parseIdList(row.realizationIds, "realizationIds"),
  };
}

export function parseSaveReimbursementDto(body: unknown): SaveReimbursementInDto {
  const row = asRecord(body);
  const realizationIds = parseIdList(row.realizationIds, "realizationIds");
  if (realizationIds.length === 0) throw new Error("Pick at least one nota");
  return {
    payeeUserId: parseObjectId(row.payeeUserId, "payeeUserId"),
    realizationIds,
    dueDate: parseOptionalYmd(row.dueDate, "dueDate"),
    notes: parseText(row.notes, "notes", NOTES_MAX),
  };
}

export function parsePayPurchasePaymentDto(body: unknown): PayPurchasePaymentInDto {
  const row = asRecord(body);
  const method = row.method;
  if (typeof method !== "string" || !(PURCHASE_PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new Error(`method must be one of: ${PURCHASE_PAYMENT_METHODS.join(", ")}`);
  }
  return {
    paidDate: parseYmd(row.paidDate, "paidDate"),
    method: method as PayPurchasePaymentInDto["method"],
    reference: parseText(row.reference, "reference", 200),
  };
}

export function parsePaymentKindFilter(raw: string | undefined): PurchasePaymentKindDto | undefined {
  if (!raw) return undefined;
  if (!(PURCHASE_PAYMENT_KINDS as readonly string[]).includes(raw)) {
    throw new Error(`kind must be one of: ${PURCHASE_PAYMENT_KINDS.join(", ")}`);
  }
  return raw as PurchasePaymentKindDto;
}

export function parsePaymentStatusFilter(raw: string | undefined): PurchasePaymentStatusDto | undefined {
  if (!raw) return undefined;
  if (!(PURCHASE_PAYMENT_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(`status must be one of: ${PURCHASE_PAYMENT_STATUSES.join(", ")}`);
  }
  return raw as PurchasePaymentStatusDto;
}
