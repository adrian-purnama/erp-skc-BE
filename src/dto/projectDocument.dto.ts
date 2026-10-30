import type { ProjectDocumentKind } from "../models/projectDocument.model";

export type ProjectDocumentOutDto = {
  id: string;
  kind: ProjectDocumentKind;
  version: number;
  isCurrent: boolean;
  isDeleted: boolean;
  contentHash: string | null;
  sameAsVersion: number | null;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  linked?: boolean;
  uploadedAt: string | null;
  uploadedByName: string | null;
  deletedAt: string | null;
  deletedByName: string | null;
};

export type ProjectDocumentsByKindOutDto = {
  kind: ProjectDocumentKind;
  current: ProjectDocumentOutDto | null;
  versions: ProjectDocumentOutDto[];
};
