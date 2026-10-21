import {
  PROJECT_LOOSE_FILE_KINDS,
  type ProjectLooseFileKind,
} from "../models/projectLooseFile/projectLooseFile.model";

export const PROJECT_LOOSE_FILE_MAX_BYTES = 20 * 1024 * 1024;

export function parseProjectLooseFileKind(
  raw: unknown,
): ProjectLooseFileKind {
  if (
    typeof raw !== "string" ||
    !PROJECT_LOOSE_FILE_KINDS.includes(raw as ProjectLooseFileKind)
  ) {
    throw new Error(
      `kind must be one of: ${PROJECT_LOOSE_FILE_KINDS.join(", ")}`,
    );
  }
  return raw as ProjectLooseFileKind;
}

/** Any file type; size capped at 20MB (also enforced by multer). */
export function assertProjectLooseFile(file: {
  originalname: string;
  mimetype: string;
  size: number;
}): void {
  if (!file || !file.originalname) {
    throw new Error("file is required");
  }
  if (!file.size || file.size < 1) {
    throw new Error("file is empty");
  }
  if (file.size > PROJECT_LOOSE_FILE_MAX_BYTES) {
    throw new Error("file must be 20MB or smaller");
  }
}
