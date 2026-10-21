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
  name: string;
  current: ProjectShopDrawingFileOutDto | null;
  versions: ProjectShopDrawingFileOutDto[];
};
