import { assertUploadFile } from "./uploadFile";

const NAME_MAX = 120;
const CATEGORY_MAX = 80;

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

export type ShopDrawingItemInDto = { name: string; category: string | null };

export function parseCreateShopDrawingItemDto(body: unknown): ShopDrawingItemInDto {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid body");
  }
  const b = body as { name?: unknown; category?: unknown };
  return {
    name: parseShopDrawingItemName(b.name),
    category: parseShopDrawingItemCategory(b.category),
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
