import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { ProjectProductionFileRepo } from "../../models/projectProductionFile.model";
import { ProjectShopDrawingBoqRepo } from "../../models/projectShopDrawingBoq.model";
import { ProjectShopDrawingDocumentRepo } from "../../models/projectShopDrawingDocument.model";
import {
  getProductionFileNames,
  getShopDrawingFileNames,
  listCurrentItemFiles,
  listShopDrawingBoqs,
} from "./project.public";

/** Chainable query stub: builder methods return itself, `exec` resolves `value`. */
function query<T>(value: T) {
  const q = { select: () => q, sort: () => q, lean: () => q, exec: async () => value };
  return q;
}

const oid = (s: string) => new Types.ObjectId(s);
const P = "6ae9bd7a2e3bbc05e91395c0";
const ITEM = "6ae9bd7a2e3bbc05e91395c1";
const SD = "6ae9bd7a2e3bbc05e91395c2";
const PF = "6ae9bd7a2e3bbc05e91395c3";
const BOQ = "6ae9bd7a2e3bbc05e91395c4";

const CURRENT_FILTER = { projectId: oid(P), isCurrent: true, isDeleted: { $ne: true } };

describe("listCurrentItemFiles", () => {
  afterEach(() => mock.restoreAll());

  it("returns each item's current, not deleted shop drawing and production files", async () => {
    const filters: unknown[] = [];
    mock.method(ProjectShopDrawingDocumentRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([{ _id: oid(SD), itemId: oid(ITEM), version: 3, originalFilename: "sd.pdf" }]);
    });
    mock.method(ProjectProductionFileRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([{ _id: oid(PF), itemId: oid(ITEM), version: 1, originalFilename: "prod.pdf" }]);
    });

    const files = await listCurrentItemFiles(P);

    assert.deepEqual(filters, [CURRENT_FILTER, CURRENT_FILTER]);
    assert.deepEqual(files, {
      shopDrawing: [{ id: SD, itemId: ITEM, version: 3, originalFilename: "sd.pdf" }],
      production: [{ id: PF, itemId: ITEM, version: 1, originalFilename: "prod.pdf" }],
    });
  });
});

describe("listShopDrawingBoqs", () => {
  afterEach(() => mock.restoreAll());

  it("returns the project's BOQs, optionally only those on given shop drawing files", async () => {
    const filters: unknown[] = [];
    const doc = { _id: oid(BOQ), projectId: oid(P), shopDrawingFileId: oid(SD) };
    mock.method(ProjectShopDrawingBoqRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([doc]);
    });

    assert.deepEqual(await listShopDrawingBoqs(P), [doc]);
    await listShopDrawingBoqs(P, { shopDrawingFileIds: [SD, SD] });

    assert.deepEqual(filters, [
      { projectId: oid(P) },
      { projectId: oid(P), shopDrawingFileId: { $in: [oid(SD)] } },
    ]);
  });

  it("returns nothing for an empty file filter without querying", async () => {
    const find = mock.method(ProjectShopDrawingBoqRepo.model, "find", () => query([{}]));
    assert.deepEqual(await listShopDrawingBoqs(P, { shopDrawingFileIds: [] }), []);
    assert.equal(find.mock.callCount(), 0);
  });
});

describe("file names by id", () => {
  afterEach(() => mock.restoreAll());

  it("maps shop drawing and production file ids to their names, deleted files included", async () => {
    const filters: unknown[] = [];
    mock.method(ProjectShopDrawingDocumentRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([{ _id: oid(SD), originalFilename: "sd.pdf" }]);
    });
    mock.method(ProjectProductionFileRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([{ _id: oid(PF), originalFilename: "prod.pdf" }]);
    });

    assert.deepEqual([...(await getShopDrawingFileNames([SD, null]))], [[SD, "sd.pdf"]]);
    assert.deepEqual([...(await getProductionFileNames([PF]))], [[PF, "prod.pdf"]]);
    assert.deepEqual(filters, [{ _id: { $in: [oid(SD)] } }, { _id: { $in: [oid(PF)] } }]);
  });

  it("queries nothing for no ids", async () => {
    const find = mock.method(ProjectProductionFileRepo.model, "find", () => query([]));
    assert.equal((await getProductionFileNames([undefined])).size, 0);
    assert.equal(find.mock.callCount(), 0);
  });
});
