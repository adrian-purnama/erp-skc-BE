import {
  PROJECT_DOCUMENT_KINDS,
  type ProjectDocumentKind,
} from "../models/projectDocument/projectDocument.model";

export const PROJECT_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

const FILENAME_MAX = 255;

export function parseProjectDocumentKind(raw: unknown): ProjectDocumentKind {
  if (typeof raw !== "string" || !PROJECT_DOCUMENT_KINDS.includes(raw as ProjectDocumentKind)) {
    throw new Error(
      `kind must be one of: ${PROJECT_DOCUMENT_KINDS.join(", ")}`,
    );
  }
  return raw as ProjectDocumentKind;
}

/** Any file type; size capped at 20MB (also enforced by multer). */
export function assertProjectDocumentFile(file: {
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
  if (file.size > PROJECT_DOCUMENT_MAX_BYTES) {
    throw new Error("file must be 20MB or smaller");
  }
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
