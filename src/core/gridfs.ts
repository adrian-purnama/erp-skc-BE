import mongoose, { Types } from "mongoose";
import { Readable } from "stream";

const { GridFSBucket } = mongoose.mongo;
type Bucket = InstanceType<typeof GridFSBucket>;

const buckets = new Map<string, Bucket>();

export type GridFsFileResult = {
  id: Types.ObjectId;
  filename: string;
};

export type UploadFileOpts = {
  buffer: Buffer;
  filename: string;
  contentType: string;
  metadata?: Record<string, unknown>;
};

export function getBucket(name: string): Bucket {
  let bucket = buckets.get(name);
  if (!bucket) {
    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB not connected");
    bucket = new GridFSBucket(db, { bucketName: name });
    buckets.set(name, bucket);
  }
  return bucket;
}

export async function uploadFile(
  name: string,
  opts: UploadFileOpts,
): Promise<GridFsFileResult> {
  const b = getBucket(name);

  return new Promise((resolve, reject) => {
    const uploadStream = b.openUploadStream(opts.filename, {
      metadata: {
        ...opts.metadata,
        contentType: opts.contentType,
      },
    });

    Readable.from(opts.buffer)
      .pipe(uploadStream)
      .on("error", reject)
      .on("finish", () => {
        resolve({
          id: uploadStream.id as Types.ObjectId,
          filename: opts.filename,
        });
      });
  });
}

export async function deleteFile(
  name: string,
  id: string | Types.ObjectId,
): Promise<void> {
  await getBucket(name).delete(new Types.ObjectId(id));
}

export async function deleteFileIfExists(
  name: string,
  id: string | Types.ObjectId,
): Promise<void> {
  try {
    await deleteFile(name, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("File not found")) return;
    throw error;
  }
}

export function openDownload(name: string, id: string | Types.ObjectId) {
  return getBucket(name).openDownloadStream(new Types.ObjectId(id));
}

export async function findFile(name: string, id: string | Types.ObjectId) {
  const files = await getBucket(name)
    .find({ _id: new Types.ObjectId(id) })
    .limit(1)
    .toArray();
  return files[0] ?? null;
}

export async function listFileIds(name: string): Promise<Types.ObjectId[]> {
  const files = await getBucket(name).find({}).project({ _id: 1 }).toArray();
  return files.map((f) => f._id as Types.ObjectId);
}

/** Read a whole GridFS file into memory (small files only, e.g. logos). */
export async function readFileBuffer(
  name: string,
  id: string | Types.ObjectId,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of openDownload(name, id)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
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
  /** GridFS bucket the blob lives in. */
  bucket: string;
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
  const { bucket } = opts;
  let linkedGridFsId: Types.ObjectId | null = null;
  if (opts.force !== true) {
    for (const id of await opts.findExistingIds()) {
      if (await findFile(bucket, id)) {
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

  const uploaded = await uploadFile(bucket, {
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
