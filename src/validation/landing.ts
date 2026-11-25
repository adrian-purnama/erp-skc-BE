import { Types } from "mongoose";
import type {
  CreateLandingCategoryDto,
  CreateLandingPostDto,
  UpdateLandingCategoryDto,
  UpdateLandingPostDto,
} from "../dto/landing.dto";
import { asRecord } from "./asRecord";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requireTrimmed(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${field} is required`);
  }
  return raw.trim();
}

/** "Bali International Hospital" -> "bali-international-hospital". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Use the given slug, or build one from `fallback` when it is blank. */
function parseSlug(raw: unknown, fallback: string): string {
  const given = typeof raw === "string" ? raw.trim() : "";
  const slug = given ? given.toLowerCase() : slugify(fallback);
  if (!SLUG.test(slug)) {
    throw new Error("Link name may use lowercase letters, numbers and single dashes");
  }
  return slug;
}

function parseBool(raw: unknown, field: string): boolean {
  if (typeof raw !== "boolean") throw new Error(`${field} must be true or false`);
  return raw;
}

function parseObjectId(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !Types.ObjectId.isValid(raw)) {
    throw new Error(`${field} is required`);
  }
  return raw;
}

export function parseCreateLandingCategoryDto(body: unknown): CreateLandingCategoryDto {
  const row = asRecord(body);
  const label = requireTrimmed(row.label, "Name");
  return { label, slug: parseSlug(row.slug, label) };
}

export function parseUpdateLandingCategoryDto(body: unknown): UpdateLandingCategoryDto {
  const row = asRecord(body);
  const patch: UpdateLandingCategoryDto = {};
  if (row.label !== undefined) patch.label = requireTrimmed(row.label, "Name");
  if (row.slug !== undefined) patch.slug = parseSlug(row.slug, patch.label ?? "");
  return patch;
}

export function parseCreateLandingPostDto(body: unknown): CreateLandingPostDto {
  const row = asRecord(body);
  const title = requireTrimmed(row.title, "Title");
  return {
    categoryId: parseObjectId(row.categoryId, "Category"),
    title,
    place: requireTrimmed(row.place, "Place"),
    slug: parseSlug(row.slug, title),
    featured: row.featured === undefined ? false : parseBool(row.featured, "featured"),
    published: row.published === undefined ? false : parseBool(row.published, "published"),
  };
}

export function parseUpdateLandingPostDto(body: unknown): UpdateLandingPostDto {
  const row = asRecord(body);
  const patch: UpdateLandingPostDto = {};
  if (row.categoryId !== undefined) patch.categoryId = parseObjectId(row.categoryId, "Category");
  if (row.title !== undefined) patch.title = requireTrimmed(row.title, "Title");
  if (row.place !== undefined) patch.place = requireTrimmed(row.place, "Place");
  if (row.slug !== undefined) patch.slug = parseSlug(row.slug, patch.title ?? "");
  if (row.featured !== undefined) patch.featured = parseBool(row.featured, "featured");
  if (row.published !== undefined) patch.published = parseBool(row.published, "published");
  return patch;
}

/** Body `{ ids: string[] }` for reorder endpoints. */
export function parseIdOrder(body: unknown): string[] {
  const row = asRecord(body);
  if (!Array.isArray(row.ids)) throw new Error("ids must be a list");
  return row.ids.map((id, index) => parseObjectId(id, `ids[${index}]`));
}
