import type { ItemUomOutDto } from "./itemMaster.dto";

export type PatchProjectRabLineInDto = {
  /** Null or empty clears the line price (and tarif ref). */
  unitPrice: string | null;
};

export type AddProjectRabLabourLineInDto = {
  itemId: string;
  itemUomId: string;
  totalQty: string;
  unitPrice?: string | null;
};

export type ProjectRabLabourItemOutDto = {
  id: string;
  itemId: string;
  name: string;
  description: string;
  baseUomId: string | null;
  uoms: ItemUomOutDto[];
};

export type ProjectRabUserRefOutDto = {
  id: string;
  name: string;
};

export type ProjectRabLineOutDto = {
  key: string;
  materialItemId: string;
  materialCode: string;
  materialName: string;
  itemUomId: string;
  uomSymbol: string;
  uomName: string;
  totalQty: string;
  unitPrice: string | null;
  tarifId: string | null;
  lineTotal: string | null;
  hasTarif: boolean;
  origin: "lock" | "append" | "labour" | null;
  addedAt: string | null;
  addedBy: ProjectRabUserRefOutDto | null;
  addReason: string | null;
  priceEditable: boolean;
};

export type ProjectRabItemGroupOutDto = {
  materialItemId: string;
  materialCode: string;
  materialName: string;
  hasTarif: boolean;
  lines: ProjectRabLineOutDto[];
};

export type ProjectRabChangeDraftRefOutDto = {
  id: string;
  reason: string;
  openedAt: string;
  openedBy: ProjectRabUserRefOutDto;
};

export type ProjectRabLineChangeKind = "added" | "removed" | "changed";

export type ProjectRabChangeBoqDiffOutDto = {
  shopDrawingItemId: string;
  shopDrawingFileId: string;
  shopDrawingItemName: string;
  fileVersion: number | null;
  kind: "added" | "removed";
};

export type ProjectRabChangeVersionDiffOutDto = {
  shopDrawingItemId: string;
  shopDrawingItemName: string;
  fromFileId: string | null;
  fromVersion: number | null;
  toFileId: string | null;
  toVersion: number | null;
};

export type ProjectRabChangeDiffOutDto = {
  lineDiff: Array<{
    key: string;
    kind: ProjectRabLineChangeKind;
    materialName: string | null;
    oldTotalQty: string | null;
    newTotalQty: string | null;
    oldUnitPrice: string | null;
    newUnitPrice: string | null;
  }>;
  boqDiff: ProjectRabChangeBoqDiffOutDto[];
  /** Items whose counted (current) file version was switched. */
  versionDiff: ProjectRabChangeVersionDiffOutDto[];
  /** Per shop-drawing file material contribution diffs (elaboration). */
  boqMaterialDiff: Array<{
    shopDrawingFileId: string;
    shopDrawingItemId: string;
    key: string;
    kind: ProjectRabLineChangeKind;
    oldTotalQty: string | null;
    newTotalQty: string | null;
  }>;
};

export type ProjectRabOutDto = {
  id: string;
  projectId: string;
  status: "draft" | "locked";
  lockedAt: string | null;
  lockedBy: ProjectRabUserRefOutDto | null;
  /** Open change draft when RAB is locked; null if none. */
  changeDraft: ProjectRabChangeDraftRefOutDto | null;
  /** Latest committed change revision; 0 if locked with no commits yet (or draft). */
  currentRevision: number;
  /** Present when a draft change is open — baseline (locked) total before draft edits. */
  baselineGrandTotal: string | null;
  /** Present when a draft change is open — line/BOQ diffs vs baseline. */
  changeDiff: ProjectRabChangeDiffOutDto | null;
  groups: ProjectRabItemGroupOutDto[];
  grandTotal: string | null;
};

export type ProjectRabElaborationLineOutDto = {
  materialItemId: string;
  itemUomId: string;
  materialName: string;
  materialCode: string;
  uomSymbol: string;
  qtyPerUnit: string;
  makeQty: string;
  totalQty: string;
};

export type ProjectRabElaborationBlockOutDto = {
  title: string;
  lines: ProjectRabElaborationLineOutDto[];
};

export type ProjectRabElaborationDocOutDto = {
  shopDrawingItemId: string;
  shopDrawingFileId: string;
  shopDrawingItemName: string;
  fileVersion: number;
  originalFilename: string;
  makeQty: string;
  blocks: ProjectRabElaborationBlockOutDto[];
};

export type ProjectRabElaborationOutDto = {
  documents: ProjectRabElaborationDocOutDto[];
};
