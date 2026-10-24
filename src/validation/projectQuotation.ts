import { Types } from "mongoose";
import type {
  PatchProjectQuotationLineInDto,
  UpdateProjectQuotationInDto,
} from "../dto/projectQuotation.dto";
import { formatDecimal, parseQtyDecimal } from "../modules/itemMaster/itemUomConvert";
import { asRecord } from "./asRecord";

const LINE_KEY = /^(boq:[a-f0-9]{24}|labour)$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function decimalField(raw: unknown, field: string, max?: number): string {
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new Error(`${field} must be a number`);
  }
  let d;
  try {
    d = parseQtyDecimal(String(raw));
  } catch {
    throw new Error(`${field} must be a non-negative number`);
  }
  if (max !== undefined && d.gt(max)) {
    throw new Error(`${field} must be at most ${max}`);
  }
  return formatDecimal(d);
}

function textField(raw: unknown, field: string, maxLength: number): string {
  if (typeof raw !== "string") throw new Error(`${field} must be a string`);
  const value = raw.trim();
  if (value.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters`);
  }
  return value;
}

export function parseVerifyToken(param: string | string[] | undefined): string {
  const raw = Array.isArray(param) ? param[0] : param;
  // Shape only; an unknown token simply reads as "unavailable".
  if (!raw || !/^[A-Za-z0-9_-]{20,64}$/.test(raw)) throw new Error("Invalid link");
  return raw;
}

export function parseQuotationLineKey(param: string | string[] | undefined): string {
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw || !LINE_KEY.test(raw)) throw new Error("Invalid line key");
  return raw;
}

export function parseUpdateProjectQuotationDto(
  body: unknown,
): UpdateProjectQuotationInDto {
  const row = asRecord(body);
  const out: UpdateProjectQuotationInDto = {};

  if (row.subject !== undefined) out.subject = textField(row.subject, "subject", 300);
  if (row.notes !== undefined) out.notes = textField(row.notes, "notes", 5000);
  if (row.markupPercent !== undefined) {
    out.markupPercent = decimalField(row.markupPercent, "markupPercent");
  }
  if (row.taxPercent !== undefined) {
    out.taxPercent = decimalField(row.taxPercent, "taxPercent", 100);
  }
  if (row.discountType !== undefined) {
    if (row.discountType !== "percent" && row.discountType !== "amount") {
      throw new Error("discountType must be percent or amount");
    }
    out.discountType = row.discountType;
  }
  if (row.discountValue !== undefined) {
    out.discountValue = decimalField(row.discountValue, "discountValue");
  }
  if (row.validUntil !== undefined) {
    if (row.validUntil === null || row.validUntil === "") {
      out.validUntil = null;
    } else if (typeof row.validUntil === "string" && YMD.test(row.validUntil)) {
      out.validUntil = row.validUntil;
    } else {
      throw new Error("validUntil must be YYYY-MM-DD");
    }
  }
  if (row.termOfPaymentId !== undefined) {
    if (row.termOfPaymentId === null || row.termOfPaymentId === "") {
      out.termOfPaymentId = null;
    } else if (
      typeof row.termOfPaymentId === "string" &&
      Types.ObjectId.isValid(row.termOfPaymentId)
    ) {
      out.termOfPaymentId = row.termOfPaymentId;
    } else {
      throw new Error("Invalid termOfPaymentId");
    }
  }

  if (Object.keys(out).length === 0) throw new Error("No fields to update");
  if (
    out.discountType === "percent" &&
    out.discountValue !== undefined &&
    parseQtyDecimal(out.discountValue).gt(100)
  ) {
    throw new Error("Discount percent must be at most 100");
  }
  return out;
}

export function parsePatchProjectQuotationLineDto(
  body: unknown,
): PatchProjectQuotationLineInDto {
  const row = asRecord(body);
  const out: PatchProjectQuotationLineInDto = {};

  if (row.description !== undefined) {
    out.description = textField(row.description, "description", 500);
    if (!out.description) throw new Error("description is required");
  }
  if (row.uom !== undefined) {
    out.uom = textField(row.uom, "uom", 30);
    if (!out.uom) throw new Error("uom is required");
  }
  if (row.unitPrice !== undefined) {
    if (row.unitPrice === null || row.unitPrice === "") {
      out.unitPrice = null;
    } else {
      const price = decimalField(row.unitPrice, "unitPrice");
      if (price.includes(".")) {
        throw new Error("unitPrice must be whole rupiah");
      }
      out.unitPrice = price;
    }
  }

  if (Object.keys(out).length === 0) throw new Error("No fields to update");
  return out;
}
