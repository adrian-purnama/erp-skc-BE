import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { ProjectRepo } from "../../models/project.model";
import { ProjectDocumentRepo } from "../../models/projectDocument.model";
import { ProjectLooseFileRepo } from "../../models/projectLooseFile.model";
import { ProjectProductionFileRepo } from "../../models/projectProductionFile.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument.model";
import {
  assertProjectsExist,
  listFileScopesMissingCurrent,
  listNonCurrentFileVersionIds,
  listUnreferencedProjectBlobIds,
  projectBlobStore,
  purgeShrinkDeletedBlobs,
  purgeUnreferencedProjectBlobs,
  shrinkFileVersion,
} from "./projectFileMaintenance";

/** Chainable query stub: builder methods return itself, `exec` resolves `value`. */
function query<T>(value: T) {
  const q = { select: () => q, sort: () => q, lean: () => q, exec: async () => value };
  return q;
}

const oid = (s: string) => new Types.ObjectId(s);
const P1 = "6ae9bd7a2e3bbc05e91395d0";
const P2 = "6ae9bd7a2e3bbc05e91395d1";
const V1 = "6ae9bd7a2e3bbc05e91395d2";
const BLOB1 = "6ae9bd7a2e3bbc05e91395d3";
const BLOB2 = "6ae9bd7a2e3bbc05e91395d4";
const BLOB3 = "6ae9bd7a2e3bbc05e91395d5";
const USER = "6ae9bd7a2e3bbc05e91395d6";
const ITEM = "6ae9bd7a2e3bbc05e91395d7";

/** Stub live-reference counts for a blob across the four file models. */
function liveRefs(counts: [number, number, number, number]) {
  const filters: unknown[] = [];
  const repos = [
    ProjectDocumentRepo,
    ProjectShopDrawingDocumentRepo,
    ProjectLooseFileRepo,
    ProjectProductionFileRepo,
  ];
  repos.forEach((repo, i) => {
    mock.method(repo.model, "countDocuments", (f: unknown) => {
      filters.push(f);
      return { exec: async () => counts[i] };
    });
  });
  return filters;
}

function blobStore(existing: string[]) {
  const deleted: string[] = [];
  mock.method(projectBlobStore, "find", async (id: Types.ObjectId | string) =>
    existing.includes(String(id)) ? { _id: id } : null,
  );
  mock.method(projectBlobStore, "delete", async (id: Types.ObjectId | string) => {
    deleted.push(String(id));
  });
  mock.method(projectBlobStore, "listIds", async () => existing.map(oid));
  return deleted;
}

describe("assertProjectsExist", () => {
  afterEach(() => mock.restoreAll());

  it("returns ObjectIds without querying when given no ids", async () => {
    const find = mock.method(ProjectRepo.model, "find", () => query([]));
    assert.deepEqual(await assertProjectsExist([]), []);
    assert.equal(find.mock.callCount(), 0);
  });

  it("returns ObjectIds when every project exists", async () => {
    mock.method(ProjectRepo.model, "find", () => query([{ _id: oid(P1) }, { _id: oid(P2) }]));
    assert.deepEqual(await assertProjectsExist([P1, P2]), [oid(P1), oid(P2)]);
  });

  it("throws listing the unknown ids", async () => {
    mock.method(ProjectRepo.model, "find", () => query([{ _id: oid(P1) }]));
    await assert.rejects(assertProjectsExist([P1, P2]), {
      message: `Unknown project id(s): ${P2}`,
    });
  });
});

describe("listNonCurrentFileVersionIds", () => {
  afterEach(() => mock.restoreAll());

  it("lists live non-current document versions", async () => {
    const filters: unknown[] = [];
    mock.method(ProjectDocumentRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([{ _id: oid(V1) }]);
    });
    assert.deepEqual(await listNonCurrentFileVersionIds("document", []), [oid(V1)]);
    assert.deepEqual(filters, [{ isCurrent: false, isDeleted: false }]);
  });

  it("excludes projects for shop drawings", async () => {
    const filters: unknown[] = [];
    mock.method(ProjectShopDrawingDocumentRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([]);
    });
    await listNonCurrentFileVersionIds("shopDrawing", [oid(P1)]);
    assert.deepEqual(filters, [
      { isCurrent: false, isDeleted: false, projectId: { $nin: [oid(P1)] } },
    ]);
  });
});

describe("shrinkFileVersion", () => {
  afterEach(() => mock.restoreAll());

  it("soft-deletes through the audited repo and purges the now unreferenced blob", async () => {
    const calls: Array<{ filter: unknown; update: { $set: Record<string, unknown> } }> = [];
    mock.method(
      ProjectDocumentRepo,
      "findOneAndUpdate",
      async (filter: unknown, update: { $set: Record<string, unknown> }) => {
        calls.push({ filter, update });
        return { _id: oid(V1), gridFsId: oid(BLOB1) };
      },
    );
    const refFilters = liveRefs([0, 0, 0, 0]);
    const deleted = blobStore([BLOB1]);

    const out = await shrinkFileVersion("document", oid(V1), oid(USER));

    assert.deepEqual(out, { softDeleted: true, blobPurged: true });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].filter, { _id: oid(V1), isCurrent: false, isDeleted: false });
    const { deletedAt, ...rest } = calls[0].update.$set;
    assert.ok(deletedAt instanceof Date);
    assert.deepEqual(rest, {
      isDeleted: true,
      isCurrent: false,
      deletedBy: oid(USER),
      deletedReason: "shrink_db",
    });
    assert.deepEqual(refFilters, Array(4).fill({ gridFsId: oid(BLOB1), isDeleted: false }));
    assert.deepEqual(deleted, [BLOB1]);
  });

  it("keeps the blob while another live row references it", async () => {
    mock.method(ProjectShopDrawingDocumentRepo, "findOneAndUpdate", async () => ({
      _id: oid(V1),
      gridFsId: oid(BLOB1),
    }));
    liveRefs([0, 0, 1, 0]);
    const deleted = blobStore([BLOB1]);

    const out = await shrinkFileVersion("shopDrawing", oid(V1), oid(USER));

    assert.deepEqual(out, { softDeleted: true, blobPurged: false });
    assert.deepEqual(deleted, []);
  });

  it("does nothing when the row is no longer a live non-current version", async () => {
    mock.method(ProjectDocumentRepo, "findOneAndUpdate", async () => null);
    const deleted = blobStore([BLOB1]);
    assert.deepEqual(await shrinkFileVersion("document", oid(V1), oid(USER)), {
      softDeleted: false,
      blobPurged: false,
    });
    assert.deepEqual(deleted, []);
  });
});

describe("purgeShrinkDeletedBlobs", () => {
  afterEach(() => mock.restoreAll());

  it("purges each shrink-deleted blob once, skipping missing blobs", async () => {
    const filters: unknown[] = [];
    mock.method(ProjectDocumentRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([{ gridFsId: oid(BLOB1) }, { gridFsId: oid(BLOB2) }]);
    });
    mock.method(ProjectShopDrawingDocumentRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([{ gridFsId: oid(BLOB1) }]);
    });
    liveRefs([0, 0, 0, 0]);
    const deleted = blobStore([BLOB1]);

    assert.equal(await purgeShrinkDeletedBlobs(), 1);
    assert.deepEqual(filters, Array(2).fill({ isDeleted: true, deletedReason: "shrink_db" }));
    assert.deepEqual(deleted, [BLOB1]);
  });
});

describe("unreferenced project blobs", () => {
  afterEach(() => mock.restoreAll());

  function referenced(ids: string[][]) {
    const repos = [
      ProjectDocumentRepo,
      ProjectShopDrawingDocumentRepo,
      ProjectLooseFileRepo,
      ProjectProductionFileRepo,
    ];
    repos.forEach((repo, i) => {
      mock.method(repo.model, "distinct", (field: string) => {
        assert.equal(field, "gridFsId");
        return { exec: async () => ids[i].map(oid) };
      });
    });
  }

  it("lists bucket blobs no file row references, deleted rows included", async () => {
    referenced([[BLOB1], [], [], []]);
    blobStore([BLOB1, BLOB2, BLOB3]);
    assert.deepEqual(await listUnreferencedProjectBlobIds(), [BLOB2, BLOB3]);
  });

  it("purges only ids that are still unreferenced", async () => {
    referenced([[], [], [BLOB1], []]);
    const deleted = blobStore([BLOB1, BLOB2]);
    assert.deepEqual(await purgeUnreferencedProjectBlobs([BLOB1, BLOB2]), {
      deleted: 1,
      skipped: 1,
    });
    assert.deepEqual(deleted, [BLOB2]);
  });
});

describe("listFileScopesMissingCurrent", () => {
  afterEach(() => mock.restoreAll());

  it("reports document kinds and shop drawing items without a live current version", async () => {
    const pipelines: unknown[] = [];
    mock.method(ProjectDocumentRepo.model, "aggregate", (p: unknown) => {
      pipelines.push(p);
      return { exec: async () => [{ _id: { projectId: oid(P1), kind: "contract" }, hasCurrent: 0 }] };
    });
    mock.method(ProjectShopDrawingDocumentRepo.model, "aggregate", (p: unknown) => {
      pipelines.push(p);
      return { exec: async () => [{ _id: { projectId: oid(P2), itemId: oid(ITEM) }, hasCurrent: 0 }] };
    });

    assert.deepEqual(await listFileScopesMissingCurrent(), [
      { kind: "document", projectId: P1, scope: "contract" },
      { kind: "shopDrawing", projectId: P2, scope: ITEM },
    ]);
    const hasCurrent = {
      $sum: {
        $cond: [{ $and: [{ $eq: ["$isCurrent", true] }, { $ne: ["$isDeleted", true] }] }, 1, 0],
      },
    };
    assert.deepEqual(pipelines, [
      [
        { $group: { _id: { projectId: "$projectId", kind: "$kind" }, hasCurrent } },
        { $match: { hasCurrent: 0 } },
      ],
      [
        { $group: { _id: { projectId: "$projectId", itemId: "$itemId" }, hasCurrent } },
        { $match: { hasCurrent: 0 } },
      ],
    ]);
  });
});
