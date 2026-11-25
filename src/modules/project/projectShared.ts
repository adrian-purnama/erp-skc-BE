import { Types } from "mongoose";
import { findFile, openDownload } from "../../core/gridfs";
import { ProjectRepo } from "../../models/project.model";

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
