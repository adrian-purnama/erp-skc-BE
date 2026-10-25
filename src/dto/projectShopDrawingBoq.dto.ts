import type { ItemUomOutDto } from "./itemMaster.dto";
import type {
  ShopDrawingBoqFinishPlacement,
  ShopDrawingBoqMountingType,
} from "../models/projectShopDrawingBoq/projectShopDrawingBoq.model";

export type ShopDrawingBoqLineInputsIn = {
  v1: string;
  v2?: string;
  v3?: string;
};

export type ShopDrawingBoqLineIn = {
  materialItemId: string;
  itemUomId: string;
  formula: string;
  inputs: ShopDrawingBoqLineInputsIn;
};

export type ShopDrawingBoqFinishingIn = {
  finishingOrder: number;
  placement: ShopDrawingBoqFinishPlacement;
  lines: ShopDrawingBoqLineIn[];
};

export type ShopDrawingBoqBaseIn = ShopDrawingBoqLineIn & {
  key: string;
  spec?: string;
  finishings: ShopDrawingBoqFinishingIn[];
};

export type ShopDrawingBoqPartIn = {
  key: string;
  label?: string;
  bases: ShopDrawingBoqBaseIn[];
};

export type ShopDrawingBoqAssemblyIn = {
  lines: ShopDrawingBoqLineIn[];
};

export type ShopDrawingBoqMainIn = {
  parts: ShopDrawingBoqPartIn[];
  assembly: ShopDrawingBoqAssemblyIn;
};

export type ShopDrawingBoqLightingIn = {
  lines: ShopDrawingBoqLineIn[];
};

export type ShopDrawingBoqMountingIn = {
  type: ShopDrawingBoqMountingType;
  lines: ShopDrawingBoqLineIn[];
};

export type ShopDrawingBoqOtherIn = {
  lines: ShopDrawingBoqLineIn[];
};

export type UpsertShopDrawingBoqIn = {
  shopDrawingItemId: string;
  shopDrawingFileId: string;
  makeQty: string;
  main: ShopDrawingBoqMainIn;
  lighting: ShopDrawingBoqLightingIn;
  mounting: ShopDrawingBoqMountingIn;
  other: ShopDrawingBoqOtherIn;
};

export type ProjectShopDrawingBoqLineInputsOutDto = {
  v1: string;
  v2?: string;
  v3?: string;
};

export type ProjectShopDrawingBoqLineOutDto = {
  materialItemId: string;
  materialCode: string;
  materialName: string;
  itemUomId: string;
  uomSymbol: string;
  uomName: string;
  formula: string;
  inputs: ProjectShopDrawingBoqLineInputsOutDto;
  qtyPerUnit: string;
  totalQty: string;
  addedAt: string | null;
  addedBy: string | null;
  addReason: string | null;
};

export type ProjectShopDrawingBoqFinishingOutDto = {
  finishingOrder: number;
  placement: ShopDrawingBoqFinishPlacement;
  lines: ProjectShopDrawingBoqLineOutDto[];
};

export type ProjectShopDrawingBoqBaseOutDto =
  ProjectShopDrawingBoqLineOutDto & {
    key: string;
    spec?: string;
    finishings: ProjectShopDrawingBoqFinishingOutDto[];
  };

export type ProjectShopDrawingBoqPartOutDto = {
  key: string;
  label?: string;
  bases: ProjectShopDrawingBoqBaseOutDto[];
};

export type ProjectShopDrawingBoqAssemblyOutDto = {
  lines: ProjectShopDrawingBoqLineOutDto[];
};

export type ProjectShopDrawingBoqMainOutDto = {
  parts: ProjectShopDrawingBoqPartOutDto[];
  assembly: ProjectShopDrawingBoqAssemblyOutDto;
};

export type ProjectShopDrawingBoqLightingOutDto = {
  lines: ProjectShopDrawingBoqLineOutDto[];
};

export type ProjectShopDrawingBoqMountingOutDto = {
  type: ShopDrawingBoqMountingType;
  lines: ProjectShopDrawingBoqLineOutDto[];
};

export type ProjectShopDrawingBoqOtherOutDto = {
  lines: ProjectShopDrawingBoqLineOutDto[];
};

export type ProjectShopDrawingBoqOutDto = {
  id: string;
  projectId: string;
  shopDrawingItemId: string;
  shopDrawingItemName: string;
  shopDrawingFileId: string;
  fileVersion: number;
  originalFilename: string;
  makeQty: string;
  main: ProjectShopDrawingBoqMainOutDto;
  lighting: ProjectShopDrawingBoqLightingOutDto;
  mounting: ProjectShopDrawingBoqMountingOutDto;
  other: ProjectShopDrawingBoqOtherOutDto;
  contentFrozen: boolean;
  contentFrozenAt: string | null;
  rabLocked: boolean;
  /** True when a RAB change draft is open — BOQ may be edited via the draft. */
  changeDraftOpen: boolean;
};

export type ProjectShopDrawingBoqMaterialOutDto = {
  id: string;
  itemId: string;
  name: string;
  description: string;
  categoryIds: string[];
  baseUomId: string | null;
  uoms: ItemUomOutDto[];
};

export type ProjectShopDrawingBoqVersionSummaryOutDto = {
  fileId: string;
  version: number;
  originalFilename: string;
  isCurrent: boolean;
  hasBoq: boolean;
};

export type ProjectShopDrawingBoqItemSummaryOutDto = {
  itemId: string;
  name: string;
  versions: ProjectShopDrawingBoqVersionSummaryOutDto[];
};
