import { Types } from "mongoose";
import {
  findFile,
  openDownload,
  uploadFile,
} from "../../buckets/gridfs";
import { ProjectRepo } from "../../models/project/project.model";

const BUCKET = "project";

/** Display name of a shop drawing item: `{code}-{name}`, or the name alone. */
export function shopDrawingItemLabel(item: {
  code?: string | null;
  name: string;
}): string {
  const code = item.code?.trim();
  return code ? `${code}-${item.name}` : item.name;
}

export async function assertProjectExists(projectId: string): Promise<void> {
  if (!Types.ObjectId.isValid(projectId)) {
    throw new Error("Invalid project id");
  }
  const project = await ProjectRepo.model.findById(projectId).lean().exec();
  if (!project) throw new Error("Project not found");
}

export type UploadDedupedBlobOpts = {
  buffer: Buffer;
  filename: string;
  contentType: string;
  contentHash: string;
  force?: boolean;
  metadata: Record<string, unknown>;
  /** Candidates newest-first; first with a live GridFS blob wins. */
  findExistingIds: () => Promise<Types.ObjectId[]>;
};

export type UploadDedupedBlobResult = {
  gridFsId: Types.ObjectId;
  linked: boolean;
  createdNewBlob: boolean;
};

/** Link an existing blob by content hash, or upload a new one. */
export async function uploadDedupedBlob(
  opts: UploadDedupedBlobOpts,
): Promise<UploadDedupedBlobResult> {
  let linkedGridFsId: Types.ObjectId | null = null;
  if (opts.force !== true) {
    for (const id of await opts.findExistingIds()) {
      if (await findFile(BUCKET, id)) {
        linkedGridFsId = id;
        break;
      }
    }
  }

  if (linkedGridFsId) {
    return {
      gridFsId: linkedGridFsId,
      linked: true,
      createdNewBlob: false,
    };
  }

  const uploaded = await uploadFile(BUCKET, {
    buffer: opts.buffer,
    filename: opts.filename,
    contentType: opts.contentType,
    metadata: opts.metadata,
  });
  return {
    gridFsId: uploaded.id,
    linked: false,
    createdNewBlob: true,
  };
}

export async function openBlob(
  gridFsId: Types.ObjectId,
  filename: string,
  contentType: string,
): Promise<{
  stream: ReturnType<typeof openDownload>;
  filename: string;
  contentType: string;
}> {
  const file = await findFile(BUCKET, gridFsId);
  if (!file) throw new Error("File blob not found");

  const meta = file.metadata as { contentType?: string } | undefined;
  return {
    stream: openDownload(BUCKET, gridFsId),
    filename,
    contentType: contentType || meta?.contentType || "application/octet-stream",
  };
}
