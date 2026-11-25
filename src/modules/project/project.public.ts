import { Types } from "mongoose";
import { ProjectRepo, type ProjectInterface } from "../../models/project.model";
import { ProjectRabRepo, type ProjectRabInterface } from "../../models/projectRab.model";
import { ProjectProductionFileRepo } from "../../models/projectProductionFile.model";
import {
  ProjectShopDrawingBoqRepo,
  type ProjectShopDrawingBoqInterface,
} from "../../models/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument.model";
import {
  ProjectShopDrawingItemRepo,
  type ShopDrawingMakeType,
} from "../../models/projectShopDrawingItem.model";

type IdLike = Types.ObjectId | string | null | undefined;

const toObjectIds = (ids: readonly IdLike[]) =>
  [...new Set(ids.filter(Boolean).map(String))]
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

// ── Projects ────────────────────────────────────────────────────────────────

/** A project as other modules see it. */
export type ProjectRefDto = {
  id: string;
  projectNumber: string;
  name: string;
  customerId: string | null;
  customerContact: ProjectInterface["customerContact"] | null;
  status: ProjectInterface["status"];
  /** Set once the project is released to production (SPKs / purchasing allowed). */
  productionReleasedAt: Date | null;
  productionReleasedBy: string | null;
};

type ProjectLean = Pick<
  ProjectInterface,
  "projectNumber" | "name" | "customerId" | "customerContact" | "status" | "productionReleasedAt" | "productionReleasedBy"
> & { _id: Types.ObjectId };

const PROJECT_FIELDS = {
  projectNumber: 1,
  name: 1,
  customerId: 1,
  customerContact: 1,
  status: 1,
  productionReleasedAt: 1,
  productionReleasedBy: 1,
} as const;

function toProjectRef(p: ProjectLean): ProjectRefDto {
  return {
    id: String(p._id),
    projectNumber: p.projectNumber ?? "",
    name: p.name ?? "",
    customerId: p.customerId ? String(p.customerId) : null,
    customerContact: p.customerContact ?? null,
    status: p.status,
    productionReleasedAt: p.productionReleasedAt ?? null,
    productionReleasedBy: p.productionReleasedBy ? String(p.productionReleasedBy) : null,
  };
}

/** Projects by id, keyed by id; `releasedOnly` keeps those released to production. */
export async function getProjectRefs(
  ids: readonly IdLike[],
  opts: { releasedOnly?: boolean } = {},
): Promise<Map<string, ProjectRefDto>> {
  const oids = toObjectIds(ids);
  if (oids.length === 0) return new Map();
  const docs = (await ProjectRepo.model
    .find({
      _id: { $in: oids },
      ...(opts.releasedOnly ? { productionReleasedAt: { $ne: null } } : {}),
    })
    .select(PROJECT_FIELDS)
    .lean()
    .exec()) as ProjectLean[];
  return new Map(docs.map((p) => [String(p._id), toProjectRef(p)]));
}

export async function getProjectRef(id: IdLike): Promise<ProjectRefDto | null> {
  return (await getProjectRefs([id])).values().next().value ?? null;
}

const WON = { status: "win", loseReason: null, closeReason: null } as const;

/** A quotation was won: the project is won (lose / close reasons cleared). Joins the caller's transaction. */
export async function markProjectWon(projectId: string): Promise<void> {
  await ProjectRepo.findByIdAndUpdate(projectId, { $set: WON });
}

/** The project is handed over to production by `userId` (and is therefore won). */
export async function markProjectReleasedToProduction(
  projectId: string,
  userId: string,
): Promise<void> {
  await ProjectRepo.findByIdAndUpdate(projectId, {
    $set: {
      productionReleasedAt: new Date(),
      productionReleasedBy: new Types.ObjectId(userId),
      ...WON,
    },
  });
}

// ── Shop drawing items ──────────────────────────────────────────────────────

/** A shop drawing item as other modules see it. */
export type ShopDrawingItemRefDto = {
  id: string;
  projectId: string;
  code: string;
  name: string;
  dimension: string;
  category: string | null;
  makeType: ShopDrawingMakeType | null;
  makeQty: string | null;
  isDeleted: boolean;
};

type ItemLean = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  code?: string;
  name: string;
  dimension?: string;
  category?: string | null;
  makeType?: ShopDrawingMakeType;
  makeQty?: string | null;
  isDeleted: boolean;
};

const ITEM_FIELDS = {
  projectId: 1,
  code: 1,
  name: 1,
  dimension: 1,
  category: 1,
  makeType: 1,
  makeQty: 1,
  isDeleted: 1,
} as const;

function toItemRef(i: ItemLean): ShopDrawingItemRefDto {
  return {
    id: String(i._id),
    projectId: String(i.projectId),
    code: i.code ?? "",
    name: i.name,
    dimension: i.dimension ?? "",
    category: i.category ?? null,
    makeType: i.makeType ?? null,
    makeQty: i.makeQty ?? null,
    isDeleted: i.isDeleted === true,
  };
}

/** Shop drawing items by id (deleted ones included: documents keep them), keyed by id. */
export async function getShopDrawingItemRefs(
  ids: readonly IdLike[],
): Promise<Map<string, ShopDrawingItemRefDto>> {
  const oids = toObjectIds(ids);
  if (oids.length === 0) return new Map();
  const docs = (await ProjectShopDrawingItemRepo.model
    .find({ _id: { $in: oids } })
    .select(ITEM_FIELDS)
    .lean()
    .exec()) as ItemLean[];
  return new Map(docs.map((i) => [String(i._id), toItemRef(i)]));
}

export async function getShopDrawingItemRef(id: IdLike): Promise<ShopDrawingItemRefDto | null> {
  return (await getShopDrawingItemRefs([id])).values().next().value ?? null;
}

/**
 * A project's live (not deleted) shop drawing items, by code then name.
 * `sorted: false` keeps stored order for callers whose output order depends on it.
 */
export async function listLiveShopDrawingItems(
  projectId: string,
  opts: { makeType?: ShopDrawingMakeType; sorted?: boolean } = {},
): Promise<ShopDrawingItemRefDto[]> {
  if (!Types.ObjectId.isValid(projectId)) return [];
  const query = ProjectShopDrawingItemRepo.model
    .find({
      projectId: new Types.ObjectId(projectId),
      isDeleted: false,
      ...(opts.makeType ? { makeType: opts.makeType } : {}),
    })
    .select(ITEM_FIELDS);
  if (opts.sorted !== false) query.sort({ code: 1, name: 1 });
  const docs = (await query.lean().exec()) as ItemLean[];
  return docs.map(toItemRef);
}

// ── RAB ─────────────────────────────────────────────────────────────────────

/** A project's RAB as plain data (a lean snapshot, never a document). */
export type ProjectRabSnapshot = ProjectRabInterface & { _id: Types.ObjectId };

/** The project's RAB, or null when it has none yet. */
export async function getProjectRab(projectId: string): Promise<ProjectRabSnapshot | null> {
  if (!Types.ObjectId.isValid(projectId)) return null;
  return (await ProjectRabRepo.model
    .findOne({ projectId: new Types.ObjectId(projectId) })
    .lean()
    .exec()) as ProjectRabSnapshot | null;
}

/** RABs of several projects. */
export async function listProjectRabs(projectIds: readonly IdLike[]): Promise<ProjectRabSnapshot[]> {
  const oids = toObjectIds(projectIds);
  if (oids.length === 0) return [];
  return (await ProjectRabRepo.model
    .find({ projectId: { $in: oids } })
    .lean()
    .exec()) as ProjectRabSnapshot[];
}

// ── Shop drawing / production files and BOQs ────────────────────────────────

/** A current file of a shop drawing item. */
export type ItemFileRefDto = { id: string; itemId: string; version: number; originalFilename: string };

/** A file is current while it is the item's latest upload and not deleted. */
const CURRENT_FILE_FILTER = { isCurrent: true, isDeleted: { $ne: true } } as const;
const FILE_REF_FIELDS = { itemId: 1, version: 1, originalFilename: 1 } as const;

type FileLean = { _id: Types.ObjectId; itemId: Types.ObjectId; version: number; originalFilename: string };
const toFileRef = (f: FileLean): ItemFileRefDto => ({
  id: String(f._id),
  itemId: String(f.itemId),
  version: f.version,
  originalFilename: f.originalFilename,
});

/** Each item's current shop drawing file and File Produksi in the project. */
export async function listCurrentItemFiles(
  projectId: string,
): Promise<{ shopDrawing: ItemFileRefDto[]; production: ItemFileRefDto[] }> {
  const filter = { projectId: new Types.ObjectId(projectId), ...CURRENT_FILE_FILTER };
  const [sd, production] = await Promise.all([
    ProjectShopDrawingDocumentRepo.model.find(filter).select(FILE_REF_FIELDS).lean().exec(),
    ProjectProductionFileRepo.model.find(filter).select(FILE_REF_FIELDS).lean().exec(),
  ]);
  return { shopDrawing: (sd as FileLean[]).map(toFileRef), production: (production as FileLean[]).map(toFileRef) };
}

/** A shop drawing BOQ as stored (the RAB / SPK / quotation planners read this shape). */
export type ShopDrawingBoqSnapshot = ProjectShopDrawingBoqInterface & { _id: Types.ObjectId };

/** The project's BOQs; only those on `shopDrawingFileIds` when given. */
export async function listShopDrawingBoqs(
  projectId: string,
  opts: { shopDrawingFileIds?: readonly IdLike[] } = {},
): Promise<ShopDrawingBoqSnapshot[]> {
  const filter: Record<string, unknown> = { projectId: new Types.ObjectId(projectId) };
  if (opts.shopDrawingFileIds) {
    const fileIds = toObjectIds(opts.shopDrawingFileIds);
    if (fileIds.length === 0) return [];
    filter.shopDrawingFileId = { $in: fileIds };
  }
  return (await ProjectShopDrawingBoqRepo.model.find(filter).lean().exec()) as ShopDrawingBoqSnapshot[];
}

type FileNameRow = { _id: Types.ObjectId; originalFilename: string };
const toNameMap = (rows: FileNameRow[]) => new Map(rows.map((r) => [String(r._id), r.originalFilename]));

/** Shop drawing file id → original filename (deleted files included: snapshots keep pointing at them). */
export async function getShopDrawingFileNames(ids: readonly IdLike[]): Promise<Map<string, string>> {
  const oids = toObjectIds(ids);
  if (oids.length === 0) return new Map();
  return toNameMap(
    await ProjectShopDrawingDocumentRepo.model
      .find({ _id: { $in: oids } })
      .select({ originalFilename: 1 })
      .lean<FileNameRow[]>()
      .exec(),
  );
}

/** File Produksi id → original filename (deleted files included). */
export async function getProductionFileNames(ids: readonly IdLike[]): Promise<Map<string, string>> {
  const oids = toObjectIds(ids);
  if (oids.length === 0) return new Map();
  return toNameMap(
    await ProjectProductionFileRepo.model
      .find({ _id: { $in: oids } })
      .select({ originalFilename: 1 })
      .lean<FileNameRow[]>()
      .exec(),
  );
}
