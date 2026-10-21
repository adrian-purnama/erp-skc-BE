import type {
  ProjectDocumentOutDto,
  ProjectDocumentsByKindOutDto,
} from "../../dto/projectDocument.dto";
import {
  PROJECT_DOCUMENT_KINDS,
  ProjectDocumentRepo,
  type ProjectDocumentKind,
} from "../../models/projectDocument/projectDocument.model";
import { assertProjectDocumentFile } from "../../validation/projectDocument";
import { assertProjectExists } from "./projectShared";
import {
  sameAsVersionFor,
  VersionedProjectFileService,
  type VersionedFileDoc,
} from "./versionedProjectFile.service";

function toOut(
  doc: VersionedFileDoc,
  names: Map<string, string>,
  extras?: { linked?: boolean; sameAsVersion?: number | null },
): ProjectDocumentOutDto {
  const uploadedById = doc.uploadedBy ? String(doc.uploadedBy) : null;
  const deletedById = doc.deletedBy ? String(doc.deletedBy) : null;
  return {
    id: String(doc._id),
    kind: doc.kind as ProjectDocumentKind,
    version: doc.version,
    isCurrent: Boolean(doc.isCurrent) && doc.isDeleted !== true,
    isDeleted: doc.isDeleted === true,
    contentHash: doc.contentHash ?? null,
    sameAsVersion:
      extras?.sameAsVersion !== undefined ? extras.sameAsVersion : null,
    originalFilename: doc.originalFilename,
    contentType: doc.contentType,
    sizeBytes: doc.sizeBytes,
    uploadedAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    uploadedByName: uploadedById ? (names.get(uploadedById) ?? null) : null,
    deletedAt: doc.deletedAt ? doc.deletedAt.toISOString() : null,
    deletedByName: deletedById ? (names.get(deletedById) ?? null) : null,
    ...(extras?.linked ? { linked: true } : {}),
  };
}

const files = new VersionedProjectFileService({
  repo: ProjectDocumentRepo,
  scopeField: "kind",
  noun: "document",
  toOut,
  assertUpload: (_projectId, _kind, file) => assertProjectDocumentFile(file),
});

export class ProjectDocumentService {
  async listByProject(
    projectId: string,
  ): Promise<ProjectDocumentsByKindOutDto[]> {
    await assertProjectExists(projectId);
    const { docs, names } = await files.list(
      { projectId },
      { kind: 1, version: -1 },
    );

    return PROJECT_DOCUMENT_KINDS.map((kind) => {
      const kindDocs = docs.filter((d) => d.kind === kind);
      const versions = kindDocs.map((d) =>
        toOut(d, names, { sameAsVersion: sameAsVersionFor(d, kindDocs) }),
      );
      const current =
        versions.find((v) => v.isCurrent && !v.isDeleted) ?? null;
      return { kind, current, versions };
    });
  }

  upload(
    projectId: string,
    kind: ProjectDocumentKind,
    file: Express.Multer.File,
    opts: { force?: boolean; uploadedByUserId?: string } = {},
  ): Promise<ProjectDocumentOutDto> {
    return files.upload(projectId, kind, file, opts);
  }

  setCurrent(projectId: string, docId: string): Promise<ProjectDocumentOutDto> {
    return files.setCurrent(projectId, docId);
  }

  rename(
    projectId: string,
    docId: string,
    originalFilename: string,
  ): Promise<ProjectDocumentOutDto> {
    return files.rename(projectId, docId, originalFilename);
  }

  async softDelete(
    projectId: string,
    docId: string,
    deletedByUserId?: string,
  ): Promise<ProjectDocumentOutDto> {
    await assertProjectExists(projectId);
    const deleted = await files.remove(projectId, docId, deletedByUserId);
    return files.present(deleted);
  }

  openDownload(projectId: string, docId: string) {
    return files.openDownload(projectId, docId);
  }
}

export const projectDocumentService = new ProjectDocumentService();
