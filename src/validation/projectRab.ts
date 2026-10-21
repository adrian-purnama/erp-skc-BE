import type { PatchProjectRabLineInDto } from "../dto/projectRab.dto";
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
