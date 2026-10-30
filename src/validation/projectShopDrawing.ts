import {
  SHOP_DRAWING_MAKE_TYPES,
  type ShopDrawingMakeType,
} from "../models/projectShopDrawingItem.model";
import { assertUploadFile } from "./uploadFile";

const NAME_MAX = 120;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORY_MAX = 80;
const CODE_MAX = 30;
const DIMENSION_MAX = 120;

export function parseShopDrawingItemName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("name is required");
  }
  const name = raw.trim().toUpperCase();
  if (!name) throw new Error("name is required");
  if (name.length > NAME_MAX) {
    throw new Error(`name must be at most ${NAME_MAX} characters`);
  }
  return name;
}

/** Empty / missing → null (uncategorized). Uppercased like item names so groups match. */
export function parseShopDrawingItemCategory(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new Error("category must be a string");
  const category = raw.trim().replace(/\s+/g, " ").toUpperCase();
  if (!category) return null;
  if (category.length > CATEGORY_MAX) {
    throw new Error(`category must be at most ${CATEGORY_MAX} characters`);
  }
  return category;
}

/** Kode such as "SA1": required, uppercased, no spaces or "-" (it separates kode from name). */
export function parseShopDrawingItemCode(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("code is required");
  const code = raw.trim().toUpperCase();
  if (!code) throw new Error("code is required");
  if (code.length > CODE_MAX) {
    throw new Error(`code must be at most ${CODE_MAX} characters`);
  }
  if (/[\s-]/.test(code)) {
    throw new Error("code cannot contain spaces or \"-\"");
  }
  return code;
}

/** Ukuran, free text (e.g. "± 810 x 60 x 730"); empty allowed. */
export function parseShopDrawingItemDimension(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") throw new Error("dimension must be a string");
  const dimension = raw.trim().replace(/\s+/g, " ");
  if (dimension.length > DIMENSION_MAX) {
    throw new Error(`dimension must be at most ${DIMENSION_MAX} characters`);
  }
  return dimension;
}

export type ShopDrawingItemInDto = {
  code: string;
  name: string;
  category: string | null;
  dimension: string;
  mockupApproveDate: string | null;
  /** Absent on update = keep the current one. */
  makeType?: ShopDrawingMakeType;
};

export function parseShopDrawingMakeType(raw: unknown): ShopDrawingMakeType | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (!SHOP_DRAWING_MAKE_TYPES.includes(raw as ShopDrawingMakeType)) {
    throw new Error(`makeType must be one of ${SHOP_DRAWING_MAKE_TYPES.join(", ")}`);
  }
  return raw as ShopDrawingMakeType;
}

/** Empty / missing / null → null; otherwise YYYY-MM-DD. */
export function parseShopDrawingItemMockupApproveDate(
  raw: unknown,
): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new Error("mockupApproveDate must be YYYY-MM-DD or null");
  }
  const ymd = raw.trim();
  if (!ymd) return null;
  if (!YMD.test(ymd)) {
    throw new Error("mockupApproveDate must be YYYY-MM-DD");
  }
  return ymd;
}

export function parseCreateShopDrawingItemDto(body: unknown): ShopDrawingItemInDto {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid body");
  }
  const b = body as {
    code?: unknown;
    name?: unknown;
    category?: unknown;
    dimension?: unknown;
    mockupApproveDate?: unknown;
    makeType?: unknown;
  };
  const makeType = parseShopDrawingMakeType(b.makeType);
  return {
    ...(makeType ? { makeType } : {}),
    code: parseShopDrawingItemCode(b.code),
    name: parseShopDrawingItemName(b.name),
    category: parseShopDrawingItemCategory(b.category),
    dimension: parseShopDrawingItemDimension(b.dimension),
    mockupApproveDate: parseShopDrawingItemMockupApproveDate(
      b.mockupApproveDate,
    ),
  };
}

export function parseRenameShopDrawingItemDto(body: unknown): ShopDrawingItemInDto {
  return parseCreateShopDrawingItemDto(body);
}

export function assertShopDrawingFile(file: {
  originalname: string;
  mimetype: string;
  size: number;
}): void {
  assertUploadFile(file);
}
