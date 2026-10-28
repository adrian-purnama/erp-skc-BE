export type ProjectShopDrawingFileOutDto = {
  id: string;
  itemId: string;
  version: number;
  isCurrent: boolean;
  isDeleted: boolean;
  contentHash: string | null;
  sameAsVersion: number | null;
  hasBoq: boolean;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  linked?: boolean;
  uploadedAt: string | null;
  uploadedByName: string | null;
  deletedAt: string | null;
  deletedByName: string | null;
};

export type ProjectShopDrawingItemOutDto = {
  id: string;
  code: string;
  name: string;
  /** `{code}-{name}`. */
  label: string;
  descriptions: string[];
  dimension: string;
  category: string | null;
  mockupApproveDate: string | null;
  current: ProjectShopDrawingFileOutDto | null;
  versions: ProjectShopDrawingFileOutDto[];
  /** File Produksi (CNC / cutting files); `hasBoq` is always false here. */
  productionCurrent: ProjectShopDrawingFileOutDto | null;
  productionVersions: ProjectShopDrawingFileOutDto[];
  /** Removed in the open RAB change; deleted on commit. */
  removedInChange: boolean;
};
