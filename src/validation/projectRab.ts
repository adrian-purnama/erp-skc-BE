import { Types } from "mongoose";
import type {
  AddProjectRabLabourLineInDto,
  PatchProjectRabLineInDto,
  SaveProjectRabChargesInDto,
  SaveProjectRabLabourProcessInDto,
} from "../dto/projectRab.dto";
import { formatDecimal, parseQtyDecimal } from "../modules/itemMaster/itemUomConvert";
import { asRecord } from "./asRecord";
import { parseChargeList } from "./purchasing";

export function parsePatchProjectRabLineDto(
  body: unknown,
): PatchProjectRabLineInDto {
  const row = asRecord(body);
  if (
    typeof row.priceByTotal === "boolean" &&
    row.unitPrice === undefined &&
    row.lineTotal === undefined
  ) {
    return { unitPrice: null, priceByTotal: row.priceByTotal };
  }
  if (row.lineTotal !== undefined && row.lineTotal !== null) {
    if (typeof row.lineTotal !== "string" || !row.lineTotal.trim()) {
      throw new Error("lineTotal must be a non-empty string");
    }
    return {
      unitPrice: null,
      lineTotal: formatDecimal(parseQtyDecimal(row.lineTotal.trim())),
    };
  }
  if (row.unitPrice === null || row.unitPrice === undefined) {
    return { unitPrice: null };
  }
  if (typeof row.unitPrice !== "string") {
    throw new Error("unitPrice must be a string or null");
  }
  if (!row.unitPrice.trim()) {
    return { unitPrice: null };
  }
  const unitPrice = formatDecimal(parseQtyDecimal(row.unitPrice.trim()));
  return { unitPrice };
}

export function parseAddProjectRabLabourLineDto(
  body: unknown,
): AddProjectRabLabourLineInDto {
  const row = asRecord(body);
  if (
    typeof row.shopDrawingItemId !== "string" ||
    !Types.ObjectId.isValid(row.shopDrawingItemId)
  ) {
    throw new Error("shopDrawingItemId is invalid");
  }
  if (typeof row.itemId !== "string" || !Types.ObjectId.isValid(row.itemId)) {
    throw new Error("itemId is invalid");
  }
  if (
    typeof row.itemUomId !== "string" ||
    !Types.ObjectId.isValid(row.itemUomId)
  ) {
    throw new Error("itemUomId is invalid");
  }
  if (typeof row.totalQty !== "string" || !row.totalQty.trim()) {
    throw new Error("totalQty is required");
  }
  const totalQty = formatDecimal(parseQtyDecimal(row.totalQty.trim()));
  let unitPrice: string | null | undefined;
  if (row.unitPrice === null) {
    unitPrice = null;
  } else if (row.unitPrice === undefined) {
    unitPrice = undefined;
  } else if (typeof row.unitPrice === "string") {
    unitPrice = row.unitPrice.trim()
      ? formatDecimal(parseQtyDecimal(row.unitPrice.trim()))
      : null;
  } else {
    throw new Error("unitPrice must be a string or null");
  }
  return {
    shopDrawingItemId: row.shopDrawingItemId,
    itemId: row.itemId,
    itemUomId: row.itemUomId,
    totalQty,
    ...(unitPrice !== undefined ? { unitPrice } : {}),
  };
}

export function parseSaveProjectRabChargesDto(
  body: unknown,
): SaveProjectRabChargesInDto {
  return { charges: parseChargeList(asRecord(body).charges) };
}

export function parseSaveProjectRabLabourProcessDto(
  body: unknown,
): SaveProjectRabLabourProcessInDto {
  const row = asRecord(body);
  if (
    typeof row.shopDrawingItemId !== "string" ||
    !Types.ObjectId.isValid(row.shopDrawingItemId)
  ) {
    throw new Error("shopDrawingItemId is invalid");
  }
  if (!Array.isArray(row.lines) || row.lines.length === 0) {
    throw new Error("lines must be a non-empty array");
  }
  const lines: SaveProjectRabLabourProcessInDto["lines"] = [];
  const seen = new Set<string>();
  for (const raw of row.lines) {
    const line = asRecord(raw);
    if (typeof line.key !== "string" || !line.key.trim()) {
      throw new Error("Each process line needs a key");
    }
    const key = line.key.trim();
    if (seen.has(key)) throw new Error(`Duplicate labour line key: ${key}`);
    seen.add(key);
    const w =
      typeof line.weightPercent === "number"
        ? line.weightPercent
        : typeof line.weightPercent === "string"
          ? Number(line.weightPercent.trim())
          : NaN;
    if (!Number.isInteger(w) || w < 1 || w > 100) {
      throw new Error("weightPercent must be an integer from 1 to 100");
    }
    lines.push({ key, weightPercent: w });
  }
  return { shopDrawingItemId: row.shopDrawingItemId, lines };
}

export function parseRabLineKey(param: string | string[] | undefined): string {
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw || !raw.trim()) {
    throw new Error("lineKey is required");
  }
  const key = raw.trim();
  // material: item:uom · labour per shop drawing: sdItem:item:uom
  const parts = key.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !p)) {
    throw new Error("Invalid lineKey");
  }
  return key;
}
