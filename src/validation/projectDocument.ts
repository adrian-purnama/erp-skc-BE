import {
  PROJECT_DOCUMENT_KINDS,
  type ProjectDocumentKind,
} from "../models/projectDocument/projectDocument.model";
import { assertUploadFile, parseFileKind } from "./uploadFile";

export const PROJECT_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

const FILENAME_MAX = 255;

export function parseProjectDocumentKind(raw: unknown): ProjectDocumentKind {
  return parseFileKind(PROJECT_DOCUMENT_KINDS, raw);
}

/** Any file type; size capped at 20MB (also enforced by multer). */
export function assertProjectDocumentFile(file: {
  originalname: string;
  mimetype: string;
  size: number;
}): void {
  assertUploadFile(file, PROJECT_DOCUMENT_MAX_BYTES);
}

export function parseRenameProjectFileDto(body: unknown): {
  originalFilename: string;
} {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid body");
  }
  const raw = (body as { originalFilename?: unknown }).originalFilename;
  if (typeof raw !== "string") {
    throw new Error("originalFilename is required");
  }
  const originalFilename = raw.trim();
  if (!originalFilename) {
    throw new Error("originalFilename is required");
  }
  if (originalFilename.length > FILENAME_MAX) {
    throw new Error(
      `originalFilename must be at most ${FILENAME_MAX} characters`,
    );
  }
  return { originalFilename };
}
