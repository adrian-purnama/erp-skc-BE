import { assertUploadFile } from "./uploadFile";

const NAME_MAX = 120;

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

export function parseCreateShopDrawingItemDto(body: unknown): { name: string } {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid body");
  }
  return { name: parseShopDrawingItemName((body as { name?: unknown }).name) };
}

export function parseRenameShopDrawingItemDto(body: unknown): { name: string } {
  return parseCreateShopDrawingItemDto(body);
}

export function assertShopDrawingFile(file: {
  originalname: string;
  mimetype: string;
  size: number;
}): void {
  assertUploadFile(file);
}
