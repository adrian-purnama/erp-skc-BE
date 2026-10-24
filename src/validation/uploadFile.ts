export type UploadFileLike = {
  originalname: string;
  mimetype: string;
  size: number;
};

export function parseFileKind<T extends string>(
  kinds: readonly T[],
  raw: unknown,
  label = "kind",
): T {
  if (typeof raw !== "string" || !kinds.includes(raw as T)) {
    throw new Error(`${label} must be one of: ${kinds.join(", ")}`);
  }
  return raw as T;
}

/** Reject a missing/empty file, and optionally cap its size. */
export function assertUploadFile(
  file: UploadFileLike | undefined | null,
  maxBytes?: number,
): void {
  if (!file || !file.originalname) {
    throw new Error("file is required");
  }
  if (!file.size || file.size < 1) {
    throw new Error("file is empty");
  }
  if (maxBytes !== undefined && file.size > maxBytes) {
    throw new Error(`file must be ${maxBytes / (1024 * 1024)}MB or smaller`);
  }
}
