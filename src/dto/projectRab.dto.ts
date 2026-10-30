import type { ItemUomOutDto } from "./itemMaster.dto";
import type { ProjectRabLineRounding } from "../models/projectRab.model";
import type { RealizationChargeInDto, RealizationChargeOutDto } from "./purchasing.dto";

export type PatchProjectRabLineInDto = {
  /** Null or empty clears the line price (and tarif ref). */
  unitPrice: string | null;
  /** Set instead of unitPrice: unit price becomes lineTotal ÷ line qty. */
  lineTotal?: string;
  /** Sent alone: only switch how the price is entered; the price is kept. */
  priceByTotal?: boolean;
};

export type AddProjectRabLabourLineInDto = {
  shopDrawingItemId: string;
  itemId: string;
  itemUomId: string;
  totalQty: string;
  unitPrice?: string | null;
};

/** Rewrite process order + weights for one drawing's labour lines (array order = sequence). */
export type SaveProjectRabLabourProcessInDto = {
  shopDrawingItemId: string;
  lines: Array<{ key: string; weightPercent: number }>;
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
  /** `/media/<id>` when loaded; omit/null when unknown. */
  profilePicture?: string | null;
};

export type ProjectRabLineOutDto = {
  key: string;
  materialItemId: string;
  materialCode: string;
  materialName: string;
  itemUomId: string;
  uomSymbol: string;
  uomName: string;
  /** Purchase qty after UOM rounding; the priced quantity. */
  totalQty: string;
  /** BOQ need before rounding (null for labour / legacy lines). */
  exactQty: string | null;
  /** totalQty − exactQty; negative when rounded down below need. */
  wasteQty: string | null;
  rounding: ProjectRabLineRounding | null;
  unitPrice: string | null;
  tarifId: string | null;
  lineTotal: string | null;
  /** Price was typed as the line total; the UI reopens it in total mode. */
  priceByTotal: boolean;
  hasTarif: boolean;
  origin: "lock" | "append" | "labour" | null;
  addedAt: string | null;
  addedBy: ProjectRabUserRefOutDto | null;
  addReason: string | null;
  priceEditable: boolean;
  /** Labour: shop drawing item it is costed to (null = project-wide). */
  shopDrawingItemId: string | null;
  shopDrawingItemName: string | null;
  /** Inhouse process order within the drawing (null if unset). */
  sequence: number | null;
  /** Inhouse process weight percent (null if unset). */
  weightPercent: number | null;
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

export type ProjectRabChangeBoqMaterialDiffOutDto = {
  shopDrawingFileId: string;
  shopDrawingItemId: string;
  /** `{kode}-{name}` of the shop drawing item. */
  shopDrawingItemName: string;
  fileVersion: number | null;
  key: string;
  kind: "added" | "removed" | "changed";
  materialCode: string | null;
  materialName: string | null;
  uomSymbol: string | null;
  oldTotalQty: string | null;
  newTotalQty: string | null;
};

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
  boqMaterialDiff: ProjectRabChangeBoqMaterialDiffOutDto[];
};

/**
 * One RAB change (committed, or the open draft) and the materials it added to,
 * changed in, or removed from shop drawings.
 */
export type ProjectRabMaterialChangeGroupOutDto = {
  changeId: string;
  status: "draft" | "committed";
  revision: number | null;
  reason: string;
  /** committedAt, or openedAt for the open draft. */
  at: string;
  by: ProjectRabUserRefOutDto | null;
  materials: ProjectRabChangeBoqMaterialDiffOutDto[];
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
  /** Locked RAB: shop drawing material changes per change, newest first. */
  materialChanges: ProjectRabMaterialChangeGroupOutDto[];
  groups: ProjectRabItemGroupOutDto[];
  /** Σ priced line totals; null while no line is priced. */
  subtotal: string | null;
  /** Extra costs on the whole RAB; percent rows priced on `subtotal`. */
  charges: RealizationChargeOutDto[];
  chargesTotal: string;
  /** subtotal + chargesTotal. */
  grandTotal: string | null;
};

export type SaveProjectRabChargesInDto = {
  charges: RealizationChargeInDto[];
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
