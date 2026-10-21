import { Types } from "mongoose";
import type {
  ConvertItemQtyDto,
  CreateFolderDto,
  CreateItemDto,
  ItemTarifInDto,
  ItemTarifOutDto,
  ItemUomInDto,
  MoveFolderDto,
  MoveItemDto,
  UpdateFolderDto,
  UpdateItemDto,
} from "../dto/itemMaster.dto";
import {
  formatDecimal,
  parsePositiveDecimal,
  parseQtyDecimal,
} from "../modules/itemMaster/itemUomConvert";
import { asRecord } from "./asRecord";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseYmdDate(raw: unknown, field = "effectiveDate"): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${field} is required`);
  }
  const ymd = raw.trim();
  if (!YMD_RE.test(ymd)) {
    throw new Error(`${field} must be YYYY-MM-DD`);
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`${field} is not a valid calendar date`);
  }
  return ymd;
}

export function todayYmdUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Pure: max effectiveDate <= asOf among rows (PeopleSoft current-row rule). */
export function pickTarifAsOf(
  rows: ItemTarifOutDto[],
  asOfYmd: string,
): ItemTarifOutDto | null {
  let best: ItemTarifOutDto | null = null;
  for (const row of rows) {
    if (row.effectiveDate > asOfYmd) continue;
    if (!best || row.effectiveDate > best.effectiveDate) {
      best = row;
    }
  }
  return best;
}

const FOLDER_CODE_RE = /^[A-Z0-9]+$/;

function parseNullableObjectId(
  raw: unknown,
  field: string,
): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !Types.ObjectId.isValid(raw)) {
    throw new Error(`Invalid ${field}`);
  }
  return raw;
}

export function parseFolderCode(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("code is required");
  }
  const code = raw.trim().toUpperCase();
  if (!FOLDER_CODE_RE.test(code)) {
    throw new Error("code must be uppercase alphanumeric");
  }
  return code;
}

export function parseCreateFolderDto(body: unknown): CreateFolderDto {
  const row = asRecord(body);
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) throw new Error("name is required");
  return {
    name,
    parentId: parseNullableObjectId(row.parentId, "parentId"),
  };
}

/**
 * Derive a base folder code from the display name.
 * Multi-word: first letter of up to 4 words. Single word: first 4 alphanumerics.
 */
export function suggestFolderCodeFromName(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return "FLD";
  if (words.length === 1) {
    return words[0]!.slice(0, 4) || "FLD";
  }
  return words
    .slice(0, 4)
    .map((w) => w[0]!)
    .join("");
}

/**
 * Pick the first unused code among siblings: BASE, BASE2, BASE3, …
 * Comparison is case-insensitive.
 */
export function allocateUniqueFolderCode(
  base: string,
  taken: Iterable<string>,
): string {
  const used = new Set(
    [...taken].map((c) => c.trim().toUpperCase()).filter(Boolean),
  );
  const root = FOLDER_CODE_RE.test(base) ? base : "FLD";
  if (!used.has(root)) return root;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${root}${n}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate a unique folder code");
}

export function parseUpdateFolderDto(body: unknown): UpdateFolderDto {
  const row = asRecord(body);
  if (row.code !== undefined) {
    throw new Error("code cannot be updated");
  }
  if (typeof row.name !== "string" || !row.name.trim()) {
    throw new Error("name is required");
  }
  return { name: row.name.trim() };
}

export function parseMoveFolderDto(body: unknown): MoveFolderDto {
  const row = asRecord(body);
  if (!("newParentId" in row)) {
    throw new Error("newParentId is required");
  }
  return {
    newParentId: parseNullableObjectId(row.newParentId, "newParentId"),
  };
}

function parseUomRow(raw: unknown, index: number): ItemUomInDto {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`uoms[${index}] is invalid`);
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.uomId !== "string" || !Types.ObjectId.isValid(row.uomId)) {
    throw new Error(`uoms[${index}].uomId is invalid`);
  }
  if (typeof row.isBase !== "boolean") {
    throw new Error(`uoms[${index}].isBase must be a boolean`);
  }

  let conversionFactor: string | null;
  if (row.isBase) {
    conversionFactor = "1";
  } else if (row.conversionFactor === null || row.conversionFactor === undefined) {
    conversionFactor = null;
  } else if (typeof row.conversionFactor === "string") {
    const trimmed = row.conversionFactor.trim();
    if (!trimmed) {
      conversionFactor = null;
    } else {
      parsePositiveDecimal(trimmed, `uoms[${index}].conversionFactor`);
      conversionFactor = trimmed;
    }
  } else if (typeof row.conversionFactor === "number") {
    throw new Error(
      `uoms[${index}].conversionFactor must be a string decimal, not a number`,
    );
  } else {
    throw new Error(`uoms[${index}].conversionFactor is invalid`);
  }

  const result: ItemUomInDto = {
    uomId: row.uomId,
    isBase: row.isBase,
    conversionFactor,
  };
  if (row.id !== undefined) {
    if (typeof row.id !== "string" || !Types.ObjectId.isValid(row.id)) {
      throw new Error(`uoms[${index}].id is invalid`);
    }
    result.id = row.id;
  }
  if (row.sortOrder !== undefined) {
    if (typeof row.sortOrder !== "number" || !Number.isFinite(row.sortOrder)) {
      throw new Error(`uoms[${index}].sortOrder must be a number`);
    }
    result.sortOrder = row.sortOrder;
  }
  return result;
}

export function parseUoms(raw: unknown): ItemUomInDto[] {
  if (!Array.isArray(raw)) throw new Error("uoms must be an array");
  if (raw.length === 0) throw new Error("At least one UOM is required");
  const rows = raw.map((item, i) => parseUomRow(item, i));
  const baseCount = rows.filter((r) => r.isBase).length;
  if (baseCount !== 1) {
    throw new Error("Exactly one base UOM is required");
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.uomId)) throw new Error("Duplicate UOM on item");
    seen.add(row.uomId);
  }
  return rows;
}

function parseTarifRow(raw: unknown, index: number): ItemTarifInDto {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`tarifs[${index}] is invalid`);
  }
  const row = raw as Record<string, unknown>;
  const effectiveDate = parseYmdDate(
    row.effectiveDate,
    `tarifs[${index}].effectiveDate`,
  );
  if (typeof row.amount !== "string" || !row.amount.trim()) {
    throw new Error(`tarifs[${index}].amount is required`);
  }
  const amount = formatDecimal(
    parseQtyDecimal(row.amount.trim()),
  );
  const result: ItemTarifInDto = { effectiveDate, amount };
  if (row.id !== undefined) {
    if (typeof row.id !== "string" || !Types.ObjectId.isValid(row.id)) {
      throw new Error(`tarifs[${index}].id is invalid`);
    }
    result.id = row.id;
  }
  return result;
}

export function parseTarifs(raw: unknown): ItemTarifInDto[] {
  if (!Array.isArray(raw)) throw new Error("tarifs must be an array");
  const rows = raw.map((item, i) => parseTarifRow(item, i));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.effectiveDate)) {
      throw new Error("Duplicate effectiveDate on item tarif");
    }
    seen.add(row.effectiveDate);
  }
  return rows;
}

function parseVendorIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error("vendorIds must be an array");
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i];
    if (typeof value !== "string" || !Types.ObjectId.isValid(value)) {
      throw new Error(`vendorIds[${i}] is invalid`);
    }
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

export function parseCreateItemDto(body: unknown): CreateItemDto {
  const row = asRecord(body);
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) throw new Error("name is required");
  const description =
    row.description === undefined
      ? undefined
      : typeof row.description === "string"
        ? row.description.trim()
        : (() => {
            throw new Error("description must be a string");
          })();
  if (row.uoms === undefined) {
    throw new Error("uoms is required");
  }
  return {
    name,
    description,
    folderId: parseNullableObjectId(row.folderId, "folderId"),
    vendorIds:
      row.vendorIds === undefined ? [] : parseVendorIds(row.vendorIds),
    uoms: parseUoms(row.uoms),
    tarifs: row.tarifs === undefined ? [] : parseTarifs(row.tarifs),
  };
}

export function parseUpdateItemDto(body: unknown): UpdateItemDto {
  const row = asRecord(body);
  const patch: UpdateItemDto = {};
  if (row.name !== undefined) {
    if (typeof row.name !== "string" || !row.name.trim()) {
      throw new Error("name is required");
    }
    patch.name = row.name.trim();
  }
  if (row.description !== undefined) {
    if (typeof row.description !== "string") {
      throw new Error("description must be a string");
    }
    patch.description = row.description.trim();
  }
  if (row.isActive !== undefined) {
    if (typeof row.isActive !== "boolean") {
      throw new Error("isActive must be a boolean");
    }
    patch.isActive = row.isActive;
  }
  if (row.vendorIds !== undefined) {
    patch.vendorIds = parseVendorIds(row.vendorIds);
  }
  if (row.uoms !== undefined) {
    patch.uoms = parseUoms(row.uoms);
  }
  if (row.tarifs !== undefined) {
    patch.tarifs = parseTarifs(row.tarifs);
  }
  if (
    patch.name === undefined &&
    patch.description === undefined &&
    patch.isActive === undefined &&
    patch.vendorIds === undefined &&
    patch.uoms === undefined &&
    patch.tarifs === undefined
  ) {
    throw new Error("No fields to update");
  }
  return patch;
}

export function parseConvertItemQtyDto(body: unknown): ConvertItemQtyDto {
  const row = asRecord(body);
  if (typeof row.qty !== "string" || !row.qty.trim()) {
    throw new Error("qty is required");
  }
  parseQtyDecimal(row.qty);
  if (typeof row.fromUomId !== "string" || !Types.ObjectId.isValid(row.fromUomId)) {
    throw new Error("fromUomId is invalid");
  }
  if (typeof row.toUomId !== "string" || !Types.ObjectId.isValid(row.toUomId)) {
    throw new Error("toUomId is invalid");
  }
  return {
    qty: row.qty.trim(),
    fromUomId: row.fromUomId,
    toUomId: row.toUomId,
  };
}

export function parseMoveItemDto(body: unknown): MoveItemDto {
  const row = asRecord(body);
  if (!("newFolderId" in row)) {
    throw new Error("newFolderId is required");
  }
  return {
    newFolderId: parseNullableObjectId(row.newFolderId, "newFolderId"),
  };
}

/** Pure helpers exported for tests */
export function pad4(sequence: number): string {
  return String(sequence).padStart(4, "0");
}

export function buildItemId(pathCodes: string[], sequence: number): string {
  const seq = pad4(sequence);
  if (pathCodes.length === 0) return seq;
  return `${pathCodes.join("/")}/${seq}`;
}
