import { Types } from "mongoose";
import type { ProjectRabChangeCurrentFile } from "../../models/projectRabChange/projectRabChange.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument/projectShopDrawingDocument.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem/projectShopDrawingItem.model";

/**
 * The current (live, non-deleted) file of every live shop drawing item.
 * Only BOQs on these files are counted into the RAB.
 */
export async function liveCurrentFiles(
  projectId: string,
): Promise<ProjectRabChangeCurrentFile[]> {
  const projectOid = new Types.ObjectId(projectId);
  const [items, files] = await Promise.all([
    ProjectShopDrawingItemRepo.model
      .find({ projectId: projectOid, isDeleted: false })
      .select({ _id: 1 })
      .lean()
      .exec(),
    ProjectShopDrawingDocumentRepo.model
      .find({ projectId: projectOid, isCurrent: true, isDeleted: { $ne: true } })
      .select({ _id: 1, itemId: 1 })
      .lean()
      .exec(),
  ]);
  const liveItems = new Set(items.map((i) => String(i._id)));
  return files
    .filter((f) => liveItems.has(String(f.itemId)))
    .map((f) => ({ shopDrawingItemId: f.itemId, shopDrawingFileId: f._id }));
}

/** file id → version, for labelling diffs. */
export async function fileVersionsById(
  fileIds: Array<string | Types.ObjectId>,
): Promise<Map<string, number>> {
  const ids = [...new Set(fileIds.map(String))].filter((id) =>
    Types.ObjectId.isValid(id),
  );
  if (ids.length === 0) return new Map();
  const rows = await ProjectShopDrawingDocumentRepo.model
    .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
    .select({ _id: 1, version: 1 })
    .lean()
    .exec();
  return new Map(rows.map((r) => [String(r._id), r.version]));
}
