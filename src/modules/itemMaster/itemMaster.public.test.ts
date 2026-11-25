import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { FolderRepo } from "../../models/folder.model";
import { ItemRepo } from "../../models/item.model";
import { ItemUomRepo } from "../../models/itemUom.model";
import { UomRepo } from "../../models/uom.model";
import {
  assertItemUomsBelong,
  getItemFolderPaths,
  getItemRefs,
  getItemUomRows,
} from "./itemMaster.public";

function query<T>(value: T) {
  const q = { select: () => q, sort: () => q, lean: () => q, exec: async () => value };
  return q;
}

const oid = (n: number) => new Types.ObjectId(`6ae9bd7a2e3bbc05e91395${String(n).padStart(2, "0")}`);
const ITEM = oid(1);
const ROOT = oid(2);
const SUB = oid(3);
const V = oid(4);

describe("itemMaster public API", () => {
  afterEach(() => mock.restoreAll());

  it("maps items to DTOs, inactive ones included", async () => {
    mock.method(ItemRepo.model, "find", () =>
      query([{ _id: ITEM, itemId: "MAT-1", name: "Steel", itemType: "material", folderId: SUB, vendorIds: [V], isActive: false }]),
    );
    assert.deepEqual((await getItemRefs([String(ITEM)])).get(String(ITEM)), {
      id: String(ITEM),
      code: "MAT-1",
      name: "Steel",
      itemType: "material",
      folderId: String(SUB),
      vendorIds: [String(V)],
      isActive: false,
    });
  });

  it("builds the folder path root → item folder", async () => {
    mock.method(ItemRepo.model, "find", () =>
      query([{ _id: ITEM, name: "Steel", itemType: "material", folderId: SUB }]),
    );
    mock.method(FolderRepo.model, "find", () =>
      query([
        { _id: ROOT, name: "Metals", parentId: null },
        { _id: SUB, name: "Steel bars", parentId: ROOT },
      ]),
    );
    assert.deepEqual((await getItemFolderPaths([ITEM])).get(String(ITEM)), ["Metals", "Steel bars"]);
  });

  it("returns UoM rows in stored order with the UoM's own decimals", async () => {
    const uomA = oid(10);
    const uomB = oid(11);
    mock.method(ItemUomRepo.model, "find", () =>
      query([
        { _id: oid(20), itemId: ITEM, uomId: uomB, isBase: false, conversionFactor: "12", decimals: 0 },
        { _id: oid(21), itemId: ITEM, uomId: uomA, isBase: true, conversionFactor: null },
      ]),
    );
    mock.method(UomRepo.model, "find", () => query([{ _id: uomA, decimals: 2 }]));
    const rows = await getItemUomRows([ITEM]);
    assert.deepEqual(
      rows.map((r) => [r.id, r.decimals, r.uomDecimals]),
      [
        [String(oid(20)), 0, undefined],
        [String(oid(21)), null, 2],
      ],
    );
  });

  it("rejects a line whose UoM belongs to another item", async () => {
    mock.method(ItemUomRepo.model, "find", () => query([{ _id: oid(30), itemId: oid(31) }]));
    await assert.rejects(
      assertItemUomsBelong([{ materialItemId: String(ITEM), itemUomId: String(oid(30)) }], "bad unit"),
      new Error("bad unit"),
    );
  });

  it("accepts lines whose UoMs belong to their items", async () => {
    mock.method(ItemUomRepo.model, "find", () => query([{ _id: oid(30), itemId: ITEM }]));
    await assert.doesNotReject(
      assertItemUomsBelong([{ materialItemId: String(ITEM), itemUomId: String(oid(30)) }]),
    );
  });
});
