import { createHash } from "crypto";
import { Types } from "mongoose";
import { deleteFileIfExists } from "../../buckets/gridfs";
import { als } from "../../core/audit/context";
import { uploadDedupedBlob } from "./projectShared";

export type IngestedProjectFile = {
  gridFsId: Types.ObjectId;
  contentHash: string;
  linked: boolean;
  createdNewBlob: boolean;
};

/** Upload or content-hash-link a file for the project bucket. */
export async function ingestProjectFile(
  file: Express.Multer.File,
  opts: {
    force?: boolean;
    uploadedByUserId?: string;
    metadata: Record<string, unknown>;
    findExistingIds: (contentHash: string) => Promise<Types.ObjectId[]>;
  },
): Promise<IngestedProjectFile> {
  const contentHash = createHash("sha256").update(file.buffer).digest("hex");
  const { gridFsId, linked, createdNewBlob } = await uploadDedupedBlob({
    buffer: file.buffer,
    filename: file.originalname,
    contentType: file.mimetype || "application/octet-stream",
    contentHash,
    force: opts.force,
    metadata: { ...opts.metadata, originalFilename: file.originalname, contentHash },
    findExistingIds: () => opts.findExistingIds(contentHash),
  });
  return { gridFsId, contentHash, linked, createdNewBlob };
}

/** Remove a freshly uploaded blob when the row write fails. */
export async function discardIngestedFile(
  ingested: IngestedProjectFile,
): Promise<void> {
  if (ingested.createdNewBlob) {
    await deleteFileIfExists("project", ingested.gridFsId);
  }
}

export function fileActorId(fromRequest?: string): string | undefined {
  return fromRequest || als.getStore()?.userId || undefined;
}

export function projectFileMetadata(
  projectId: string,
  scopeField: string,
  scope: string,
): Record<string, unknown> {
  return { projectId, [scopeField]: scope };
}
