import {
  PROJECT_LOOSE_FILE_KINDS,
  type ProjectLooseFileKind,
} from "../models/projectLooseFile.model";
import { assertUploadFile, parseFileKind } from "./uploadFile";

export const PROJECT_LOOSE_FILE_MAX_BYTES = 20 * 1024 * 1024;

export function parseProjectLooseFileKind(
  raw: unknown,
): ProjectLooseFileKind {
  return parseFileKind(PROJECT_LOOSE_FILE_KINDS, raw);
}

/** Any file type; size capped at 20MB (also enforced by multer). */
export function assertProjectLooseFile(file: {
  originalname: string;
  mimetype: string;
  size: number;
}): void {
  assertUploadFile(file, PROJECT_LOOSE_FILE_MAX_BYTES);
}
