import { Types } from "mongoose";
import type {
  ShopDrawingBoqAssemblyIn,
  ShopDrawingBoqBaseIn,
  ShopDrawingBoqFinishingIn,
  ShopDrawingBoqLineIn,
  ShopDrawingBoqLineInputsIn,
  ShopDrawingBoqMainIn,
  ShopDrawingBoqPartIn,
  UpsertShopDrawingBoqIn,
} from "../dto/projectShopDrawingBoq.dto";
import {
  SHOP_DRAWING_BOQ_FINISH_PLACEMENTS,
  SHOP_DRAWING_BOQ_MOUNTING_TYPES,
  type ShopDrawingBoqFinishPlacement,
  type ShopDrawingBoqMountingType,
} from "../models/projectShopDrawingBoq.model";
import {
  formatDecimal,
  parsePositiveDecimal,
} from "../modules/itemMaster/itemUomConvert";
import { parseUomFormula } from "../modules/uom/uomFormula";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function parseObjectId(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !Types.ObjectId.isValid(raw)) {
    throw new Error(`Invalid ${field}`);
  }
  return raw;
}

function parseOptionalTrimmedString(
  raw: unknown,
  field: string,
): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw new Error(`${field} must be a string`);
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function parseLineInputs(
  raw: unknown,
  formula: string,
  path: string,
): ShopDrawingBoqLineInputsIn {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${path}.inputs is required`);
  }
  const row = raw as Record<string, unknown>;
  const parsed = parseUomFormula(formula);
  const inputs: ShopDrawingBoqLineInputsIn = { v1: "" };

  for (const name of parsed.variables) {
    const value = row[name];
    if (typeof value !== "string") {
      throw new Error(`${path}.inputs.${name} is required`);
    }
    const formatted = formatDecimal(
      parsePositiveDecimal(value, `${path}.inputs.${name}`),
    );
    if (name === "v1") inputs.v1 = formatted;
    else if (name === "v2") inputs.v2 = formatted;
    else if (name === "v3") inputs.v3 = formatted;
  }

  return inputs;
}

function parseMaterialLine(
  raw: unknown,
  path: string,
  seenPair: Set<string>,
): ShopDrawingBoqLineIn {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid line at ${path}`);
  }
  const line = raw as Record<string, unknown>;
  const materialItemId = parseObjectId(
    line.materialItemId,
    `${path}.materialItemId`,
  );
  const itemUomId = parseObjectId(line.itemUomId, `${path}.itemUomId`);

  let formulaRaw = line.formula;
  let inputsRaw = line.inputs;
  if (
    (formulaRaw === undefined || formulaRaw === null) &&
    typeof line.qtyPerUnit === "string"
  ) {
    formulaRaw = "v1";
    inputsRaw = { v1: line.qtyPerUnit };
  }
  if (typeof formulaRaw !== "string" || !formulaRaw.trim()) {
    throw new Error(`${path}.formula is required`);
  }
  const formula = parseUomFormula(formulaRaw).expression;
  const inputs = parseLineInputs(inputsRaw, formula, path);

  const pairKey = `${materialItemId}:${itemUomId}`;
  if (seenPair.has(pairKey)) {
    throw new Error("Same material with the same UOM cannot appear twice");
  }
  seenPair.add(pairKey);

  let yieldQty = "1";
  if (line.yieldQty !== undefined && line.yieldQty !== null && line.yieldQty !== "") {
    if (typeof line.yieldQty !== "string" && typeof line.yieldQty !== "number") {
      throw new Error(`${path}.yieldQty must be a number`);
    }
    yieldQty = formatDecimal(
      parsePositiveDecimal(String(line.yieldQty), `${path}.yieldQty`),
    );
  }

  return { materialItemId, itemUomId, formula, inputs, yieldQty };
}

function parseLineList(
  raw: unknown,
  path: string,
): ShopDrawingBoqLineIn[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`${path} must be an array`);
  const seenPair = new Set<string>();
  return raw.map((line, index) =>
    parseMaterialLine(line, `${path}[${index}]`, seenPair),
  );
}

function parseFinishPlacement(
  raw: unknown,
  path: string,
): ShopDrawingBoqFinishPlacement {
  if (
    typeof raw !== "string" ||
    !(SHOP_DRAWING_BOQ_FINISH_PLACEMENTS as readonly string[]).includes(raw)
  ) {
    throw new Error(`${path} must be top or bottom`);
  }
  return raw as ShopDrawingBoqFinishPlacement;
}

function parseFinishings(
  raw: unknown,
  path: string,
): ShopDrawingBoqFinishingIn[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`${path} must be an array`);

  const finishings = raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Invalid finishing at ${path}[${index}]`);
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.finishingOrder !== "number" ||
      !Number.isInteger(row.finishingOrder) ||
      row.finishingOrder < 1
    ) {
      throw new Error(
        `${path}[${index}].finishingOrder must be a positive integer`,
      );
    }
    const placement = parseFinishPlacement(
      row.placement,
      `${path}[${index}].placement`,
    );
    const lines = parseLineList(row.lines, `${path}[${index}].lines`);
    if (lines.length !== 1) {
      throw new Error(`${path}[${index}].lines must have exactly one line`);
    }
    return {
      finishingOrder: row.finishingOrder,
      placement,
      lines,
    };
  });

  const orderKeys = finishings.map((f) => `${f.placement}:${f.finishingOrder}`);
  if (new Set(orderKeys).size !== orderKeys.length) {
    throw new Error(
      `${path} finishingOrder must be unique within each placement`,
    );
  }

  return finishings.sort((a, b) => {
    if (a.placement !== b.placement) {
      return a.placement === "top" ? -1 : 1;
    }
    return a.finishingOrder - b.finishingOrder;
  });
}

function parseBases(raw: unknown, path: string): ShopDrawingBoqBaseIn[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${path} must have at least one base material`);
  }
  const keys = new Set<string>();
  const seenPair = new Set<string>();
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Invalid base at ${path}[${index}]`);
    }
    const row = item as Record<string, unknown>;
    const linePath = `${path}[${index}]`;
    if (typeof row.key !== "string" || !row.key.trim()) {
      throw new Error(`${linePath}.key is required`);
    }
    const key = row.key.trim();
    if (keys.has(key)) throw new Error(`Duplicate base key: ${key}`);
    keys.add(key);

    const line = parseMaterialLine(item, linePath, seenPair);
    const spec = parseOptionalTrimmedString(row.spec, `${linePath}.spec`);
    const finishings = parseFinishings(
      row.finishings,
      `${linePath}.finishings`,
    );
    const base: ShopDrawingBoqBaseIn = { key, ...line, finishings };
    if (spec) base.spec = spec;
    return base;
  });
}

function parseParts(raw: unknown, path: string): ShopDrawingBoqPartIn[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`${path} must be an array`);

  const keys = new Set<string>();
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Invalid part at ${path}[${index}]`);
    }
    const row = item as Record<string, unknown>;
    if (typeof row.key !== "string" || !row.key.trim()) {
      throw new Error(`${path}[${index}].key is required`);
    }
    const key = row.key.trim();
    if (keys.has(key)) throw new Error(`Duplicate part key: ${key}`);
    keys.add(key);

    const label = parseOptionalTrimmedString(
      row.label,
      `${path}[${index}].label`,
    );
    const bases = parseBases(row.bases, `${path}[${index}].bases`);

    const part: ShopDrawingBoqPartIn = { key, bases };
    if (label) part.label = label;
    return part;
  });
}

function parseAssembly(raw: unknown): ShopDrawingBoqAssemblyIn {
  if (raw === undefined || raw === null) {
    return { lines: [] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("main.assembly must be an object");
  }
  const row = raw as Record<string, unknown>;
  return { lines: parseLineList(row.lines, "main.assembly.lines") };
}

function parseMain(raw: unknown): ShopDrawingBoqMainIn {
  if (raw === undefined || raw === null) {
    return { parts: [], assembly: { lines: [] } };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("main must be an object");
  }
  const row = raw as Record<string, unknown>;
  const parts = parseParts(row.parts, "main.parts");
  const assembly = parseAssembly(row.assembly);
  return { parts, assembly };
}

function parseMountingType(
  raw: unknown,
  path: string,
): ShopDrawingBoqMountingType {
  if (
    typeof raw !== "string" ||
    !(SHOP_DRAWING_BOQ_MOUNTING_TYPES as readonly string[]).includes(raw)
  ) {
    throw new Error(`${path} must be a valid mounting type`);
  }
  return raw as ShopDrawingBoqMountingType;
}

export function parseUpsertShopDrawingBoqDto(
  body: unknown,
): UpsertShopDrawingBoqIn {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid body");
  }
  const b = body as Record<string, unknown>;
  const shopDrawingItemId = parseObjectId(
    b.shopDrawingItemId,
    "shopDrawingItemId",
  );
  const shopDrawingFileId = parseObjectId(
    b.shopDrawingFileId,
    "shopDrawingFileId",
  );
  if (typeof b.makeQty !== "string") {
    throw new Error("makeQty is required");
  }
  const makeQty = formatDecimal(parsePositiveDecimal(b.makeQty, "makeQty"));

  let mockupApproveDate: string | null = null;
  if (b.mockupApproveDate !== undefined && b.mockupApproveDate !== null) {
    if (typeof b.mockupApproveDate !== "string") {
      throw new Error("mockupApproveDate must be YYYY-MM-DD or null");
    }
    const ymd = b.mockupApproveDate.trim();
    if (ymd) {
      if (!YMD.test(ymd)) {
        throw new Error("mockupApproveDate must be YYYY-MM-DD");
      }
      mockupApproveDate = ymd;
    }
  }

  const main = parseMain(b.main);

  let lightingRaw = b.lighting;
  if (lightingRaw === undefined || lightingRaw === null) {
    lightingRaw = { lines: [] };
  }
  if (!lightingRaw || typeof lightingRaw !== "object" || Array.isArray(lightingRaw)) {
    throw new Error("lighting must be an object");
  }
  const lightingRow = lightingRaw as Record<string, unknown>;
  const lighting = {
    lines: parseLineList(lightingRow.lines, "lighting.lines"),
  };

  let mountingRaw = b.mounting;
  if (mountingRaw === undefined || mountingRaw === null) {
    mountingRaw = { type: "mounted", lines: [] };
  }
  if (!mountingRaw || typeof mountingRaw !== "object" || Array.isArray(mountingRaw)) {
    throw new Error("mounting must be an object");
  }
  const mountingRow = mountingRaw as Record<string, unknown>;
  const mounting = {
    type: parseMountingType(mountingRow.type, "mounting.type"),
    lines: parseLineList(mountingRow.lines, "mounting.lines"),
  };

  let otherRaw = b.other;
  if (otherRaw === undefined || otherRaw === null) {
    otherRaw = { lines: [] };
  }
  if (!otherRaw || typeof otherRaw !== "object" || Array.isArray(otherRaw)) {
    throw new Error("other must be an object");
  }
  const otherRow = otherRaw as Record<string, unknown>;
  const other = {
    lines: parseLineList(otherRow.lines, "other.lines"),
  };

  return {
    shopDrawingItemId,
    shopDrawingFileId,
    makeQty,
    mockupApproveDate,
    main,
    lighting,
    mounting,
    other,
  };
}
