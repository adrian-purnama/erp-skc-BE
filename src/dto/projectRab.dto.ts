export type PatchProjectRabLineInDto = {
  /** Null or empty clears the line price (and tarif ref). */
  unitPrice: string | null;
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
  origin: "lock" | "append" | null;
  addedAt: string | null;
  addedBy: ProjectRabUserRefOutDto | null;
  priceEditable: boolean;
};

export type ProjectRabItemGroupOutDto = {
  materialItemId: string;
  materialCode: string;
  materialName: string;
  hasTarif: boolean;
  lines: ProjectRabLineOutDto[];
};

export type ProjectRabOutDto = {
  id: string;
  projectId: string;
  status: "draft" | "locked";
  lockedAt: string | null;
  lockedBy: ProjectRabUserRefOutDto | null;
  groups: ProjectRabItemGroupOutDto[];
  grandTotal: string | null;
};

export type ProjectRabElaborationLineOutDto = {
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
  shopDrawingItemName: string;
  fileVersion: number;
  originalFilename: string;
  makeQty: string;
  blocks: ProjectRabElaborationBlockOutDto[];
};

export type ProjectRabElaborationOutDto = {
  documents: ProjectRabElaborationDocOutDto[];
};
