import { Types, type ClientSession } from "mongoose";
import { withTx } from "../../core/audit/context";
import type {
  ChildrenNode,
  ConvertItemQtyDto,
  ConvertItemQtyOutDto,
  CreateFolderDto,
  CreateItemDto,
  FolderOutDto,
  ItemOutDto,
  ItemTarifOutDto,
  ItemUomOutDto,
  MoveFolderDto,
  MoveItemDto,
  TreeFolderNode,
  TreeNode,
  UpdateFolderDto,
  UpdateItemDto,
} from "../../dto/itemMaster.dto";
import { env } from "../../environment/env";
import { FolderRepo, type FolderInterface } from "../../models/folder/folder.model";
import { ItemRepo, type ItemInterface } from "../../models/item/item.model";
import { ItemSeqCounterModel } from "../../models/seqCounter/seqCounter.model";
import { VendorRepo } from "../../models/vendor/vendor.model";
import {
  allocateUniqueFolderCode,
  buildItemId,
  pickTarifAsOf,
  suggestFolderCodeFromName,
  todayYmdUtc,
} from "../../validation/itemMaster";
import { itemCategoryService } from "./itemCategory.service";
import { itemTarifService } from "./itemTarif.service";
import { convertItemQty } from "./itemUomConvert";
import { itemUomService } from "./itemUom.service";
import { folderPathUp } from "./folderPath";

type FolderLean = FolderInterface & { _id: Types.ObjectId };
type ItemLean = ItemInterface & { _id: Types.ObjectId };

const ROOT_SCOPE = "root";
const ORPHAN_CODE = "ORPHAN";
const ORPHAN_NAME = "Orphan";

function scopeKey(folderId: string | null): string {
  return folderId ?? ROOT_SCOPE;
}

function toFolderOut(doc: FolderLean): FolderOutDto {
  return {
    id: String(doc._id),
    code: doc.code,
    name: doc.name,
    parentId: doc.parentId ? String(doc.parentId) : null,
  };
}

function resolveItemType(doc: ItemLean): ItemInterface["itemType"] {
  return doc.itemType ?? "material";
}

function toItemOut(
  doc: ItemLean,
  uoms: ItemUomOutDto[] = [],
  tarifs: ItemTarifOutDto[] = [],
  asOfYmd: string = todayYmdUtc(),
): ItemOutDto {
  return {
    id: String(doc._id),
    itemId: doc.itemId,
    name: doc.name,
    description: doc.description,
    itemType: resolveItemType(doc),
    folderId: doc.folderId ? String(doc.folderId) : null,
    categoryIds: (doc.categoryIds ?? []).map((id) => String(id)),
    baseUomId: doc.baseUomId ? String(doc.baseUomId) : null,
    vendorIds: (doc.vendorIds ?? []).map((id) => String(id)),
    isActive: doc.isActive !== false,
    uoms,
    tarifs,
    currentTarif: pickTarifAsOf(tarifs, asOfYmd),
  };
}

async function assertCategoriesExist(categoryIds: string[]): Promise<void> {
  if (categoryIds.length === 0) return;
  await Promise.all(
    categoryIds.map((id) => itemCategoryService.assertExists(id)),
  );
}

async function assertActiveVendors(vendorIds: string[]): Promise<void> {
  if (vendorIds.length === 0) return;
  const objectIds = vendorIds.map((id) => new Types.ObjectId(id));
  const docs = await VendorRepo.model
    .find({ _id: { $in: objectIds } })
    .select({ name: 1, isActive: 1 })
    .lean()
    .exec();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const bad: string[] = [];
  for (const id of vendorIds) {
    const doc = byId.get(id);
    if (!doc) {
      bad.push(`${id} (not found)`);
      continue;
    }
    if (doc.isActive === false) {
      bad.push(`${doc.name || id} (disabled)`);
    }
  }
  if (bad.length > 0) {
    throw new Error(`Invalid or inactive vendors: ${bad.join(", ")}`);
  }
}

export class ItemMasterService {
  private async allocateSequence(
    folderId: string | null,
    session: ClientSession,
  ): Promise<number> {
    const key = scopeKey(folderId);
    const updated = await ItemSeqCounterModel.findOneAndUpdate(
      { scopeKey: key },
      { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey: key } },
      { upsert: true, new: true, session },
    ).exec();
    if (!updated || updated.nextSeq < 1) {
      throw new Error("Failed to allocate item sequence");
    }
    // nextSeq starts at 0; after $inc the value is the allocated sequence.
    return updated.nextSeq;
  }

  private async getFolder(
    id: string,
    session?: ClientSession,
  ): Promise<FolderLean> {
    if (!Types.ObjectId.isValid(id)) throw new Error("Folder not found");
    let q = FolderRepo.model.findById(id);
    if (session) q = q.session(session);
    const doc = await q.lean().exec();
    if (!doc) throw new Error("Folder not found");
    return doc as FolderLean;
  }

  private async getItem(
    id: string,
    session?: ClientSession,
  ): Promise<ItemLean> {
    if (!Types.ObjectId.isValid(id)) throw new Error("Item not found");
    let q = ItemRepo.model.findById(id);
    if (session) q = q.session(session);
    const doc = await q.lean().exec();
    if (!doc) throw new Error("Item not found");
    return doc as ItemLean;
  }

  async listActiveItems(
    itemType?: ItemInterface["itemType"],
  ): Promise<ItemOutDto[]> {
    const filter: Record<string, unknown> = { isActive: { $ne: false } };
    if (itemType === "material") {
      // Legacy rows without itemType count as material.
      filter.$or = [
        { itemType: "material" },
        { itemType: { $exists: false } },
        { itemType: null },
      ];
    } else if (itemType !== undefined) {
      filter.itemType = itemType;
    }
    const docs = await ItemRepo.model
      .find(filter)
      .sort({ itemId: 1 })
      .lean()
      .exec();
    return docs.map((doc) => toItemOut(doc as ItemLean));
  }

  async getById(
    id: string,
    asOfYmd: string = todayYmdUtc(),
  ): Promise<ItemOutDto | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await ItemRepo.model.findById(id).lean().exec();
    if (!doc) return null;
    const [uoms, tarifs] = await Promise.all([
      itemUomService.listByItem(id),
      itemTarifService.listByItem(id),
    ]);
    return toItemOut(doc as ItemLean, uoms, tarifs, asOfYmd);
  }

  async getActiveById(id: string): Promise<ItemOutDto | null> {
    const row = await this.getById(id);
    if (!row || !row.isActive) return null;
    return row;
  }

  /** Codes from root → folder (inclusive). Empty if folderId null. */
  private async pathCodesToFolder(
    folderId: string | null,
    session?: ClientSession,
    /** In-tx overrides (e.g. folder code just renamed but snapshot lag). */
    codeOverrides?: ReadonlyMap<string, string>,
  ): Promise<string[]> {
    if (!folderId) return [];
    const nodes = await folderPathUp(folderId, async (id) => {
      const folder = await this.getFolder(id, session);
      return {
        parentId: folder.parentId ? String(folder.parentId) : null,
        value: codeOverrides?.get(id) ?? folder.code,
      };
    });
    return nodes.map((node) => node.value);
  }

  private async folderDepth(
    folderId: string | null,
    session?: ClientSession,
  ): Promise<number> {
    return (await this.pathCodesToFolder(folderId, session)).length;
  }

  private async assertSiblingCodeUnique(
    parentId: string | null,
    code: string,
    excludeId?: string,
    session?: ClientSession,
  ): Promise<void> {
    const filter: Record<string, unknown> = {
      parentId: parentId ? new Types.ObjectId(parentId) : null,
      code,
    };
    if (excludeId) {
      filter._id = { $ne: new Types.ObjectId(excludeId) };
    }
    let q = FolderRepo.model.findOne(filter).collation({
      locale: "en",
      strength: 2,
    });
    if (session) q = q.session(session);
    const existing = await q.lean().exec();
    if (existing) {
      throw new Error(`Folder code "${code}" already exists under this parent`);
    }
  }

  /** BFS below (excluding) root; depth of a direct child is 1. */
  private async walkDescendants(
    rootId: string,
    session?: ClientSession,
  ): Promise<Array<{ id: string; depth: number }>> {
    const result: Array<{ id: string; depth: number }> = [];
    let frontier = [rootId];
    let depth = 0;
    while (frontier.length > 0) {
      let q = FolderRepo.model.find({
        parentId: { $in: frontier.map((id) => new Types.ObjectId(id)) },
      });
      if (session) q = q.session(session);
      const children = (await q.lean().exec()) as FolderLean[];
      depth += 1;
      frontier = children.map((c) => String(c._id));
      result.push(...frontier.map((id) => ({ id, depth })));
    }
    return result;
  }

  private async collectDescendantFolderIds(
    rootId: string,
    session?: ClientSession,
  ): Promise<string[]> {
    return (await this.walkDescendants(rootId, session)).map((node) => node.id);
  }

  private async maxRelativeDepth(
    rootId: string,
    session?: ClientSession,
  ): Promise<number> {
    const nodes = await this.walkDescendants(rootId, session);
    return nodes.reduce((max, node) => Math.max(max, node.depth), 0);
  }

  private async isDescendantOf(
    candidateId: string,
    ancestorId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    if (candidateId === ancestorId) return true;
    const path = await folderPathUp(candidateId, async (id) => {
      const folder = await this.getFolder(id, session);
      return {
        parentId: folder.parentId ? String(folder.parentId) : null,
        value: id,
      };
    });
    return path.some((node) => node.id === ancestorId);
  }

  /**
   * Rebuild itemId from current folder path + sequence.
   * Keeps item codes aligned after folder move or item move.
   */
  private async syncItemId(
    item: ItemLean,
    session: ClientSession,
    codeOverrides?: ReadonlyMap<string, string>,
  ): Promise<ItemLean> {
    const folderId = item.folderId ? String(item.folderId) : null;
    const path = await this.pathCodesToFolder(
      folderId,
      session,
      codeOverrides,
    );
    const newItemId = buildItemId(path, item.sequence);
    if (newItemId === item.itemId) return item;
    const updated = await ItemRepo.findByIdAndUpdate(String(item._id), {
      $set: { itemId: newItemId },
    });
    if (!updated) throw new Error("Failed to regenerate itemId");
    return { ...item, itemId: newItemId };
  }

  private async regenerateItemsUnderFolders(
    folderIds: string[],
    session: ClientSession,
    codeOverrides?: ReadonlyMap<string, string>,
  ): Promise<void> {
    if (folderIds.length === 0) return;
    const pathCache = new Map<string, string[]>();
    const getPath = async (folderId: string) => {
      const cached = pathCache.get(folderId);
      if (cached) return cached;
      const path = await this.pathCodesToFolder(
        folderId,
        session,
        codeOverrides,
      );
      pathCache.set(folderId, path);
      return path;
    };

    let q = ItemRepo.model.find({
      folderId: { $in: folderIds.map((id) => new Types.ObjectId(id)) },
    });
    q = q.session(session);
    const items = (await q.lean().exec()) as ItemLean[];

    // Longer ids first so temporary unique-index collisions are less likely
    // when shortening a folder code (OLDNAME-0001 → NEW-0001).
    items.sort((a, b) => b.itemId.length - a.itemId.length);

    for (const item of items) {
      const folderId = item.folderId ? String(item.folderId) : null;
      if (!folderId) continue;
      const path = await getPath(folderId);
      const newItemId = buildItemId(path, item.sequence);
      if (newItemId === item.itemId) continue;
      const updated = await ItemRepo.findByIdAndUpdate(String(item._id), {
        $set: { itemId: newItemId },
      });
      if (!updated) throw new Error("Failed to regenerate itemId");
    }
  }

  async getTree(): Promise<TreeNode[]> {
    const [folders, items] = await Promise.all([
      FolderRepo.model.find().lean().exec() as Promise<FolderLean[]>,
      ItemRepo.model.find().lean().exec() as Promise<ItemLean[]>,
    ]);

    const folderNodes = new Map<string, TreeFolderNode>();
    for (const f of folders) {
      folderNodes.set(String(f._id), {
        type: "folder",
        id: String(f._id),
        code: f.code,
        name: f.name,
        children: [],
      });
    }

    const roots: TreeNode[] = [];

    for (const f of folders) {
      const node = folderNodes.get(String(f._id))!;
      if (f.parentId) {
        const parent = folderNodes.get(String(f.parentId));
        if (parent) parent.children.push(node);
        else roots.push(node);
      } else {
        roots.push(node);
      }
    }

    for (const item of items) {
      const node: TreeNode = {
        type: "item",
        id: String(item._id),
        itemId: item.itemId,
        name: item.name,
        description: item.description,
        itemType: resolveItemType(item),
        categoryIds: (item.categoryIds ?? []).map((id) => String(id)),
        isActive: item.isActive !== false,
      };
      if (item.folderId) {
        const parent = folderNodes.get(String(item.folderId));
        if (parent) parent.children.push(node);
        else roots.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        if (a.type === "folder" && b.type === "folder") {
          return a.code.localeCompare(b.code);
        }
        if (a.type === "item" && b.type === "item") {
          return a.itemId.localeCompare(b.itemId);
        }
        return 0;
      });
      for (const n of nodes) {
        if (n.type === "folder") sortNodes(n.children);
      }
    };
    sortNodes(roots);
    return roots;
  }

  async getChildren(folderId: string): Promise<ChildrenNode[]> {
    await this.getFolder(folderId);
    const [folders, items] = await Promise.all([
      FolderRepo.model
        .find({ parentId: folderId })
        .sort({ code: 1 })
        .lean()
        .exec() as Promise<FolderLean[]>,
      ItemRepo.model
        .find({ folderId })
        .sort({ itemId: 1 })
        .lean()
        .exec() as Promise<ItemLean[]>,
    ]);
    const result: ChildrenNode[] = [
      ...folders.map(
        (f): ChildrenNode => ({
          type: "folder",
          id: String(f._id),
          code: f.code,
          name: f.name,
        }),
      ),
      ...items.map(
        (i): ChildrenNode => ({
          type: "item",
          id: String(i._id),
          itemId: i.itemId,
          name: i.name,
          description: i.description,
          itemType: resolveItemType(i),
          categoryIds: (i.categoryIds ?? []).map((id) => String(id)),
          isActive: i.isActive !== false,
        }),
      ),
    ];
    return result;
  }

  private async listSiblingCodes(
    parentId: string | null,
    session: ClientSession,
  ): Promise<string[]> {
    let q = FolderRepo.model.find({
      parentId: parentId ? new Types.ObjectId(parentId) : null,
    });
    q = q.session(session);
    const siblings = (await q.lean().exec()) as FolderLean[];
    return siblings.map((s) => s.code);
  }

  async createFolder(input: CreateFolderDto): Promise<FolderOutDto> {
    return withTx(async (session) => {
      if (input.parentId) {
        await this.getFolder(input.parentId, session);
        const depth = (await this.folderDepth(input.parentId, session)) + 1;
        if (depth > env.itemMasterMaxFolderDepth) {
          throw new Error(
            `Maximum folder depth is ${env.itemMasterMaxFolderDepth}`,
          );
        }
      } else if (env.itemMasterMaxFolderDepth < 1) {
        throw new Error(
          `Maximum folder depth is ${env.itemMasterMaxFolderDepth}`,
        );
      }

      const taken = await this.listSiblingCodes(input.parentId, session);
      const code = allocateUniqueFolderCode(
        suggestFolderCodeFromName(input.name),
        taken,
      );

      const created = await FolderRepo.create({
        code,
        name: input.name,
        parentId: input.parentId ? new Types.ObjectId(input.parentId) : null,
      });
      return toFolderOut({
        _id: created._id as Types.ObjectId,
        code,
        name: input.name,
        parentId: input.parentId ? new Types.ObjectId(input.parentId) : null,
      });
    });
  }

  async updateFolder(
    id: string,
    patch: UpdateFolderDto,
  ): Promise<FolderOutDto> {
    return withTx(async (session) => {
      const existing = await this.getFolder(id, session);
      const updated = await FolderRepo.findByIdAndUpdate(id, {
        $set: { name: patch.name },
      });
      if (!updated) throw new Error("Folder not found");

      return toFolderOut({
        _id: new Types.ObjectId(id),
        code: existing.code,
        name: patch.name,
        parentId: existing.parentId,
      });
    });
  }

  async moveFolder(id: string, input: MoveFolderDto): Promise<FolderOutDto> {
    return withTx(async (session) => {
      const folder = await this.getFolder(id, session);
      const newParentId = input.newParentId;

      if (newParentId === id) {
        throw new Error("Cannot move a folder into itself");
      }
      if (newParentId) {
        await this.getFolder(newParentId, session);
        if (await this.isDescendantOf(newParentId, id, session)) {
          throw new Error("Cannot move a folder into its own descendant");
        }
      }

      const oldParentId = folder.parentId ? String(folder.parentId) : null;
      if (oldParentId === newParentId) {
        return toFolderOut(folder);
      }

      await this.assertSiblingCodeUnique(
        newParentId,
        folder.code,
        id,
        session,
      );

      const parentDepth = await this.folderDepth(newParentId, session);
      const relative = await this.maxRelativeDepth(id, session);
      const newDepth = parentDepth + 1 + relative;
      if (newDepth > env.itemMasterMaxFolderDepth) {
        throw new Error(
          `Maximum folder depth is ${env.itemMasterMaxFolderDepth}`,
        );
      }

      const updated = await FolderRepo.findByIdAndUpdate(id, {
        $set: {
          parentId: newParentId ? new Types.ObjectId(newParentId) : null,
        },
      });
      if (!updated) throw new Error("Folder not found");

      const descendantIds = await this.collectDescendantFolderIds(id, session);
      await this.regenerateItemsUnderFolders([id, ...descendantIds], session);

      return toFolderOut({
        ...folder,
        parentId: newParentId ? new Types.ObjectId(newParentId) : null,
      });
    });
  }

  private async ensureOrphanFolder(
    session: ClientSession,
  ): Promise<FolderLean> {
    const existing = (await FolderRepo.model
      .findOne({ parentId: null, code: ORPHAN_CODE })
      .collation({ locale: "en", strength: 2 })
      .session(session)
      .lean()
      .exec()) as FolderLean | null;
    if (existing) return existing;

    const created = await FolderRepo.create({
      code: ORPHAN_CODE,
      name: ORPHAN_NAME,
      parentId: null,
    });
    return {
      _id: created._id as Types.ObjectId,
      code: ORPHAN_CODE,
      name: ORPHAN_NAME,
      parentId: null,
    };
  }

  private async relocateItemToFolder(
    item: ItemLean,
    newFolderId: string,
    session: ClientSession,
  ): Promise<void> {
    const oldFolderId = item.folderId ? String(item.folderId) : null;
    if (oldFolderId === newFolderId) {
      await this.syncItemId(item, session);
      return;
    }
    const sequence = await this.allocateSequence(newFolderId, session);
    const path = await this.pathCodesToFolder(newFolderId, session);
    const itemId = buildItemId(path, sequence);
    const updated = await ItemRepo.findByIdAndUpdate(String(item._id), {
      $set: {
        folderId: new Types.ObjectId(newFolderId),
        sequence,
        itemId,
      },
    });
    if (!updated) throw new Error("Failed to move item to Orphan");
  }

  async deleteFolder(id: string, force = false): Promise<void> {
    await withTx(async (session) => {
      const folder = await this.getFolder(id, session);
      if (
        !folder.parentId &&
        folder.code.toUpperCase() === ORPHAN_CODE
      ) {
        throw new Error("Cannot delete the Orphan folder");
      }

      const [childFolder, childItem] = await Promise.all([
        FolderRepo.model
          .findOne({ parentId: id })
          .session(session)
          .lean()
          .exec(),
        ItemRepo.model.findOne({ folderId: id }).session(session).lean().exec(),
      ]);
      const notEmpty = Boolean(childFolder || childItem);

      if (!force) {
        if (notEmpty) {
          throw new Error("Folder is not empty");
        }
        const deleted = await FolderRepo.deleteOne({ _id: id });
        if (!deleted) throw new Error("Folder not found");
        return;
      }

      if (!notEmpty) {
        const deleted = await FolderRepo.deleteOne({ _id: id });
        if (!deleted) throw new Error("Folder not found");
        return;
      }

      const orphan = await this.ensureOrphanFolder(session);
      const orphanId = String(orphan._id);
      if (orphanId === id) {
        throw new Error("Cannot delete the Orphan folder");
      }

      const descendants = await this.collectDescendantFolderIds(id, session);
      if (descendants.includes(orphanId)) {
        throw new Error("Cannot delete a folder that contains Orphan");
      }
      const subtreeIds = [id, ...descendants];

      const items = (await ItemRepo.model
        .find({
          folderId: {
            $in: subtreeIds.map((fid) => new Types.ObjectId(fid)),
          },
        })
        .session(session)
        .lean()
        .exec()) as ItemLean[];

      for (const item of items) {
        await this.relocateItemToFolder(item, orphanId, session);
      }

      for (const folderId of [...descendants].reverse()) {
        const removed = await FolderRepo.deleteOne({ _id: folderId });
        if (!removed) throw new Error("Folder not found");
      }
      const deleted = await FolderRepo.deleteOne({ _id: id });
      if (!deleted) throw new Error("Folder not found");
    });
  }

  async createItem(input: CreateItemDto): Promise<ItemOutDto> {
    return withTx(async (session) => {
      if (input.folderId) {
        await this.getFolder(input.folderId, session);
      }
      const categoryIds = input.categoryIds ?? [];
      await assertCategoriesExist(categoryIds);
      const vendorIds = input.vendorIds ?? [];
      await assertActiveVendors(vendorIds);
      const sequence = await this.allocateSequence(input.folderId, session);
      const path = await this.pathCodesToFolder(input.folderId, session);
      const itemId = buildItemId(path, sequence);

      const created = await ItemRepo.create({
        itemId,
        sequence,
        name: input.name,
        description: input.description ?? "",
        itemType: input.itemType,
        folderId: input.folderId
          ? new Types.ObjectId(input.folderId)
          : null,
        categoryIds: categoryIds.map((id) => new Types.ObjectId(id)),
        baseUomId: null,
        vendorIds: vendorIds.map((id) => new Types.ObjectId(id)),
        isActive: true,
      });

      const mongoId = String(created._id);
      const uoms = await itemUomService.replaceForItem(mongoId, input.uoms);
      const tarifs = await itemTarifService.replaceForItem(
        mongoId,
        input.tarifs ?? [],
      );
      const fresh = await this.getItem(mongoId, session);

      return toItemOut(fresh, uoms, tarifs);
    });
  }

  async updateItem(id: string, patch: UpdateItemDto): Promise<ItemOutDto> {
    return withTx(async (session) => {
      const existing = await this.getItem(id, session);
      if (patch.vendorIds !== undefined) {
        await assertActiveVendors(patch.vendorIds);
      }
      if (patch.categoryIds !== undefined) {
        await assertCategoriesExist(patch.categoryIds);
      }
      const updated = await ItemRepo.findByIdAndUpdate(id, {
        $set: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined
            ? { description: patch.description }
            : {}),
          ...(patch.itemType !== undefined
            ? { itemType: patch.itemType }
            : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
          ...(patch.categoryIds !== undefined
            ? {
                categoryIds: patch.categoryIds.map(
                  (cid) => new Types.ObjectId(cid),
                ),
              }
            : {}),
          ...(patch.vendorIds !== undefined
            ? {
                vendorIds: patch.vendorIds.map(
                  (vid) => new Types.ObjectId(vid),
                ),
              }
            : {}),
        },
      });
      if (!updated) throw new Error("Item not found");

      // Re-sync itemId from folder path (repairs drift after folder renames).
      const synced = await this.syncItemId(
        {
          ...existing,
          name: patch.name ?? existing.name,
          description: patch.description ?? existing.description,
          itemType: patch.itemType ?? resolveItemType(existing),
          isActive:
            patch.isActive !== undefined ? patch.isActive : existing.isActive,
          categoryIds:
            patch.categoryIds !== undefined
              ? patch.categoryIds.map((cid) => new Types.ObjectId(cid))
              : existing.categoryIds,
          vendorIds:
            patch.vendorIds !== undefined
              ? patch.vendorIds.map((vid) => new Types.ObjectId(vid))
              : existing.vendorIds,
        },
        session,
      );

      const uoms =
        patch.uoms !== undefined
          ? await itemUomService.replaceForItem(id, patch.uoms)
          : await itemUomService.listByItem(id);
      const tarifs =
        patch.tarifs !== undefined
          ? await itemTarifService.replaceForItem(id, patch.tarifs)
          : await itemTarifService.listByItem(id);

      return toItemOut(synced, uoms, tarifs);
    });
  }

  async moveItem(id: string, input: MoveItemDto): Promise<ItemOutDto> {
    return withTx(async (session) => {
      const item = await this.getItem(id, session);
      const newFolderId = input.newFolderId;
      if (newFolderId) {
        await this.getFolder(newFolderId, session);
      }

      const oldFolderId = item.folderId ? String(item.folderId) : null;
      const [uoms, tarifs] = await Promise.all([
        itemUomService.listByItem(id),
        itemTarifService.listByItem(id),
      ]);
      if (oldFolderId === newFolderId) {
        const synced = await this.syncItemId(item, session);
        return toItemOut(synced, uoms, tarifs);
      }

      const sequence = await this.allocateSequence(newFolderId, session);
      const path = await this.pathCodesToFolder(newFolderId, session);
      const itemId = buildItemId(path, sequence);

      const updated = await ItemRepo.findByIdAndUpdate(id, {
        $set: {
          folderId: newFolderId ? new Types.ObjectId(newFolderId) : null,
          sequence,
          itemId,
        },
      });
      if (!updated) throw new Error("Item not found");

      return toItemOut(
        {
          ...item,
          folderId: newFolderId ? new Types.ObjectId(newFolderId) : null,
          sequence,
          itemId,
        },
        uoms,
        tarifs,
      );
    });
  }

  async convertItemQty(
    id: string,
    input: ConvertItemQtyDto,
  ): Promise<ConvertItemQtyOutDto> {
    await this.getItem(id);
    const uoms = await itemUomService.listByItem(id);
    const qty = convertItemQty(
      input.qty,
      input.fromUomId,
      input.toUomId,
      uoms.map((u) => ({
        uomId: u.uomId,
        conversionFactor: u.conversionFactor,
      })),
    );
    return { qty };
  }

  async deleteItem(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new Error("Item not found");
    await withTx(async () => {
      await itemUomService.deleteByItem(id);
      await itemTarifService.deleteByItem(id);
      const deleted = await ItemRepo.deleteOne({ _id: id });
      if (!deleted) throw new Error("Item not found");
    });
  }
}

export const itemMasterService = new ItemMasterService();
