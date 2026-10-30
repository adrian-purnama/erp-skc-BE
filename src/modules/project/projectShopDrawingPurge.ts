import type { Types } from "mongoose";
import { deleteFileIfExists } from "../../core/gridfs";
import { withTx } from "../../core/audit/context";
import { ProjectProductionFileRepo } from "../../models/projectProductionFile.model";
import { ProjectShopDrawingBoqRepo } from "../../models/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument.model";
import { ProjectShopDrawingItemRepo } from "../../models/projectShopDrawingItem.model";

/**
 * Delete a shop drawing item with its BOQs, SD files and File Produksi.
 * Callers decide it is allowed (RAB unlocked, or a committed RAB change).
 * Kept free of service imports so the RAB change service can call it.
 */
export async function purgeShopDrawingItem(
  projectId: string,
  itemId: string,
): Promise<void> {
  const [sdRows, productionRows] = await Promise.all([
    ProjectShopDrawingDocumentRepo.model
      .find({ projectId, itemId })
      .select({ gridFsId: 1 })
      .lean()
      .exec(),
    ProjectProductionFileRepo.model
      .find({ projectId, itemId })
      .select({ gridFsId: 1 })
      .lean()
      .exec(),
  ]);

  await withTx(async () => {
    await ProjectShopDrawingBoqRepo.deleteMany({
      projectId,
      shopDrawingItemId: itemId,
    });
    await ProjectShopDrawingDocumentRepo.deleteMany({ projectId, itemId });
    await ProjectProductionFileRepo.deleteMany({ projectId, itemId });
    const removed = await ProjectShopDrawingItemRepo.deleteOne({
      _id: itemId,
      projectId,
    });
    if (!removed) throw new Error("Item not found");
  });

  // Blobs are deduped per collection: purge each once nothing references it.
  const purge = async (
    ids: Types.ObjectId[],
    countRefs: (id: Types.ObjectId) => Promise<number>,
  ) => {
    for (const id of new Set(ids.map(String))) {
      const oid = ids.find((x) => String(x) === id)!;
      if ((await countRefs(oid)) === 0) {
        await deleteFileIfExists("project", oid);
      }
    }
  };
  await purge(
    sdRows.map((r) => r.gridFsId),
    (gridFsId) =>
      ProjectShopDrawingDocumentRepo.model.countDocuments({ gridFsId }).exec(),
  );
  await purge(
    productionRows.map((r) => r.gridFsId),
    (gridFsId) =>
      ProjectProductionFileRepo.model.countDocuments({ gridFsId }).exec(),
  );
}
