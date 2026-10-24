import { Types } from "mongoose";
import type {
  AddProjectRabLabourLineInDto,
  PatchProjectRabLineInDto,
} from "../dto/projectRab.dto";
import { formatDecimal, parseQtyDecimal } from "../modules/itemMaster/itemUomConvert";
import { asRecord } from "./asRecord";

export function parsePatchProjectRabLineDto(
  body: unknown,
): PatchProjectRabLineInDto {
  const row = asRecord(body);
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
    itemId: row.itemId,
    itemUomId: row.itemUomId,
    totalQty,
    ...(unitPrice !== undefined ? { unitPrice } : {}),
  };
}

export function parseRabLineKey(param: string | string[] | undefined): string {
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw || !raw.trim()) {
    throw new Error("lineKey is required");
  }
  const key = raw.trim();
  const parts = key.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid lineKey");
  }
  return key;
}
