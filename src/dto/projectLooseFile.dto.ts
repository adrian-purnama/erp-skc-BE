import type { ProjectLooseFileKind } from "../models/projectLooseFile/projectLooseFile.model";

export type ProjectLooseFileOutDto = {
  id: string;
  kind: ProjectLooseFileKind;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  contentHash?: string | null;
  isDeleted: boolean;
  uploadedAt: string | null;
  uploadedByName: string | null;
  deletedAt: string | null;
  deletedByName: string | null;
  linked?: boolean;
};

export type ProjectLooseFilesByKindOutDto = {
  kind: ProjectLooseFileKind;
  files: ProjectLooseFileOutDto[];
};
