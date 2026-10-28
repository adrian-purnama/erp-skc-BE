import { assertUploadFile } from "./uploadFile";

const NAME_MAX = 120;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORY_MAX = 80;
const CODE_MAX = 30;
const DIMENSION_MAX = 120;
const DESCRIPTION_LINE_MAX = 300;
const DESCRIPTION_LINES_MAX = 40;

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

/** Keterangan: an array of lines, or one string split on new lines. Blank lines dropped. */
export function parseShopDrawingItemDescriptions(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  const lines =
    typeof raw === "string"
      ? raw.split(/\r?\n/)
      : Array.isArray(raw)
        ? raw
        : null;
  if (!lines) throw new Error("descriptions must be a list of lines");
  const out: string[] = [];
  for (const line of lines) {
    if (typeof line !== "string") {
      throw new Error("descriptions must be a list of lines");
    }
    const text = line.trim();
    if (!text) continue;
    if (text.length > DESCRIPTION_LINE_MAX) {
      throw new Error(
        `each description line must be at most ${DESCRIPTION_LINE_MAX} characters`,
      );
    }
    out.push(text);
  }
  if (out.length > DESCRIPTION_LINES_MAX) {
    throw new Error(`at most ${DESCRIPTION_LINES_MAX} description lines`);
  }
  return out;
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
  descriptions: string[];
  dimension: string;
  mockupApproveDate: string | null;
};

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
    descriptions?: unknown;
    dimension?: unknown;
    mockupApproveDate?: unknown;
  };
  return {
    code: parseShopDrawingItemCode(b.code),
    name: parseShopDrawingItemName(b.name),
    category: parseShopDrawingItemCategory(b.category),
    descriptions: parseShopDrawingItemDescriptions(b.descriptions),
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
