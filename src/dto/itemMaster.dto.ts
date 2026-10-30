import type { ItemType } from "../models/item.model";
import type { ItemUomRoundingMode } from "../models/itemUom.model";

export type { ItemType };

export type CreateFolderDto = {
  name: string;
  parentId: string | null;
};

export type UpdateFolderDto = {
  name: string;
};

export type MoveFolderDto = {
  newParentId: string | null;
};

export type ItemUomInDto = {
  id?: string;
  uomId: string;
  isBase: boolean;
  /** Related factor vs base, or null if not related. Base is always stored as "1". */
  conversionFactor: string | null;
  /** RAB decimals in this unit; null = the UOM's decimals. */
  decimals?: number | null;
  /** Defaults to "up". */
  rounding?: ItemUomRoundingMode;
  sortOrder?: number;
};

export type ItemTarifInDto = {
  id?: string;
  effectiveDate: string;
  amount: string;
};

export type CreateItemCategoryDto = {
  name: string;
};

export type UpdateItemCategoryDto = {
  name: string;
};

export type ItemCategoryOutDto = {
  id: string;
  name: string;
};

export type CreateItemDto = {
  name: string;
  description?: string;
  itemType: ItemType;
  folderId: string | null;
  categoryIds?: string[];
  vendorIds?: string[];
  uoms: ItemUomInDto[];
  tarifs?: ItemTarifInDto[];
};

export type UpdateItemDto = {
  name?: string;
  description?: string;
  itemType?: ItemType;
  isActive?: boolean;
  categoryIds?: string[];
  vendorIds?: string[];
  uoms?: ItemUomInDto[];
  tarifs?: ItemTarifInDto[];
};

export type MoveItemDto = {
  newFolderId: string | null;
};

export type ConvertItemQtyDto = {
  qty: string;
  fromUomId: string;
  toUomId: string;
};

export type FolderOutDto = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
};

export type ItemUomOutDto = {
  id: string;
  itemId: string;
  uomId: string;
  isBase: boolean;
  conversionFactor: string | null;
  decimals: number | null;
  rounding: ItemUomRoundingMode;
  sortOrder: number;
  symbol: string;
  name: string;
  /** Live catalog formulas for UI mode picker only. */
  formulas: string[];
  /** The UOM's own decimals: the RAB fallback when `decimals` is null. */
  uomDecimals: number;
};

export type ItemTarifOutDto = {
  id: string;
  itemId: string;
  effectiveDate: string;
  amount: string;
};

export type ItemOutDto = {
  id: string;
  itemId: string;
  name: string;
  description: string;
  itemType: ItemType;
  folderId: string | null;
  categoryIds: string[];
  baseUomId: string | null;
  vendorIds: string[];
  isActive: boolean;
  uoms: ItemUomOutDto[];
  tarifs: ItemTarifOutDto[];
  currentTarif: ItemTarifOutDto | null;
};

export type ConvertItemQtyOutDto = {
  qty: string;
};

export type TreeFolderNode = {
  type: "folder";
  id: string;
  code: string;
  name: string;
  children: TreeNode[];
};

export type TreeItemNode = {
  type: "item";
  id: string;
  itemId: string;
  name: string;
  description: string;
  itemType: ItemType;
  categoryIds: string[];
  isActive: boolean;
};

export type TreeNode = TreeFolderNode | TreeItemNode;

export type ChildrenFolderNode = {
  type: "folder";
  id: string;
  code: string;
  name: string;
};

export type ChildrenItemNode = {
  type: "item";
  id: string;
  itemId: string;
  name: string;
  description: string;
  itemType: ItemType;
  categoryIds: string[];
  isActive: boolean;
};

export type ChildrenNode = ChildrenFolderNode | ChildrenItemNode;
