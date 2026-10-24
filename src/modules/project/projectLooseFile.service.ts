import { Types } from "mongoose";
import { deleteFileIfExists, openDownload } from "../../buckets/gridfs";
import type {
  ProjectLooseFileOutDto,
  ProjectLooseFilesByKindOutDto,
} from "../../dto/projectLooseFile.dto";
import {
  PROJECT_LOOSE_FILE_KINDS,
  ProjectLooseFileRepo,
  type ProjectLooseFileInterface,
  type ProjectLooseFileKind,
} from "../../models/projectLooseFile/projectLooseFile.model";
import { userEmailsById } from "../../utils/shared";
import { assertProjectLooseFile } from "../../validation/projectLooseFile";
import {
  discardIngestedFile,
  fileActorId,
  ingestProjectFile,
  projectFileMetadata,
} from "./fileIngest";
import { assertProjectExists, openBlob } from "./projectShared";

type LooseLean = ProjectLooseFileInterface & { _id: Types.ObjectId };

function toOut(
  doc: LooseLean,
  names: Map<string, string>,
  opts: { linked?: boolean } = {},
): ProjectLooseFileOutDto {
  const uploadedById = doc.uploadedBy ? String(doc.uploadedBy) : null;
  const deletedById = doc.deletedBy ? String(doc.deletedBy) : null;
  return {
    id: String(doc._id),
    kind: doc.kind,
    originalFilename: doc.originalFilename,
    contentType: doc.contentType,
    sizeBytes: doc.sizeBytes,
    contentHash: doc.contentHash ?? null,
    isDeleted: doc.isDeleted === true,
    uploadedAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    uploadedByName: uploadedById ? (names.get(uploadedById) ?? null) : null,
    deletedAt: doc.deletedAt ? doc.deletedAt.toISOString() : null,
    deletedByName: deletedById ? (names.get(deletedById) ?? null) : null,
    linked: opts.linked || undefined,
  };
}

export class ProjectLooseFileService {
  async listByProject(
    projectId: string,
  ): Promise<ProjectLooseFilesByKindOutDto[]> {
    await assertProjectExists(projectId);
    const docs = (await ProjectLooseFileRepo.model
      .find({ projectId })
      .sort({ createdAt: -1 })
      .lean()
      .exec()) as LooseLean[];

    const names = await userEmailsById(
      docs.flatMap((d) =>
        [d.uploadedBy, d.deletedBy].filter(Boolean).map(String),
      ),
    );

    return PROJECT_LOOSE_FILE_KINDS.map((kind) => ({
      kind,
      files: docs.filter((d) => d.kind === kind).map((d) => toOut(d, names)),
    }));
  }

  async upload(
    projectId: string,
    kind: ProjectLooseFileKind,
    file: Express.Multer.File,
    opts: { force?: boolean; uploadedByUserId?: string } = {},
  ): Promise<ProjectLooseFileOutDto> {
    await assertProjectExists(projectId);
    assertProjectLooseFile(file);

    const actorId = fileActorId(opts.uploadedByUserId);
    const contentType = file.mimetype || "application/octet-stream";

    const ingested = await ingestProjectFile(file, {
      force: opts.force,
      metadata: projectFileMetadata(projectId, "kind", kind),
      findExistingIds: async (contentHash) => {
        const candidates = (await ProjectLooseFileRepo.model
          .find({ contentHash })
          .sort({ createdAt: -1 })
          .lean()
          .exec()) as LooseLean[];
        return candidates.map((c) => c.gridFsId);
      },
    });
    const { gridFsId, contentHash, linked } = ingested;

    try {
      const created = await ProjectLooseFileRepo.create({
        projectId: new Types.ObjectId(projectId),
        kind,
        gridFsId,
        contentHash,
        originalFilename: file.originalname,
        contentType,
        sizeBytes: file.size,
        uploadedBy: actorId ? new Types.ObjectId(actorId) : undefined,
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
      });

      const fresh = (await ProjectLooseFileRepo.model
        .findById(created._id)
        .lean()
        .exec()) as LooseLean | null;
      if (!fresh) throw new Error("File uploaded but not found");

      const names = await userEmailsById(
        [fresh.uploadedBy].filter(Boolean).map(String),
      );
      return toOut(fresh, names, { linked: linked || undefined });
    } catch (error) {
      await discardIngestedFile(ingested);
      throw error;
    }
  }

  async rename(
    projectId: string,
    fileId: string,
    originalFilename: string,
  ): Promise<ProjectLooseFileOutDto> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(fileId)) {
      throw new Error("Invalid file id");
    }

    const existing = (await ProjectLooseFileRepo.model
      .findOne({ _id: fileId, projectId })
      .lean()
      .exec()) as LooseLean | null;
    if (!existing) throw new Error("File not found");
    if (existing.isDeleted) throw new Error("Cannot rename a deleted file");

    const updated = await ProjectLooseFileRepo.findByIdAndUpdate(fileId, {
      $set: { originalFilename },
    });
    if (!updated) throw new Error("File not found");

    const fresh = (await ProjectLooseFileRepo.model
      .findById(fileId)
      .lean()
      .exec()) as LooseLean | null;
    if (!fresh) throw new Error("File not found");

    const names = await userEmailsById(
      [fresh.uploadedBy, fresh.deletedBy].filter(Boolean).map(String),
    );
    return toOut(fresh, names);
  }

  async softDelete(
    projectId: string,
    fileId: string,
    deletedByUserId?: string,
  ): Promise<ProjectLooseFileOutDto> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(fileId)) {
      throw new Error("Invalid file id");
    }

    const existing = (await ProjectLooseFileRepo.model
      .findOne({ _id: fileId, projectId })
      .lean()
      .exec()) as LooseLean | null;
    if (!existing) throw new Error("File not found");
    if (existing.isDeleted) throw new Error("File already deleted");

    const actorId = fileActorId(deletedByUserId);

    const updated = await ProjectLooseFileRepo.findByIdAndUpdate(fileId, {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: actorId ? new Types.ObjectId(actorId) : null,
      },
    });
    if (!updated) throw new Error("File not found");

    const liveRefs = await ProjectLooseFileRepo.model
      .countDocuments({
        gridFsId: existing.gridFsId,
        isDeleted: false,
      })
      .exec();
    if (liveRefs === 0) {
      await deleteFileIfExists("project", existing.gridFsId);
    }

    const fresh = (await ProjectLooseFileRepo.model
      .findById(fileId)
      .lean()
      .exec()) as LooseLean | null;
    if (!fresh) throw new Error("File not found");

    const names = await userEmailsById(
      [fresh.uploadedBy, fresh.deletedBy].filter(Boolean).map(String),
    );
    return toOut(fresh, names);
  }

  async openDownload(
    projectId: string,
    fileId: string,
  ): Promise<{
    stream: ReturnType<typeof openDownload>;
    filename: string;
    contentType: string;
  }> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(fileId)) {
      throw new Error("Invalid file id");
    }

    const doc = (await ProjectLooseFileRepo.model
      .findOne({ _id: fileId, projectId })
      .lean()
      .exec()) as LooseLean | null;
    if (!doc) throw new Error("File not found");
    if (doc.isDeleted) throw new Error("File deleted");

    return openBlob(doc.gridFsId, doc.originalFilename, doc.contentType);
  }
}

export const projectLooseFileService = new ProjectLooseFileService();
