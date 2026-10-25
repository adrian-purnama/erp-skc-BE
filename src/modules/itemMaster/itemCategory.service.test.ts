import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Documents the cascade contract for category delete:
 * $pull categoryId from item.categoryIds, then remove the category.
 */
describe("itemCategory delete cascade (contract)", () => {
  it("pulls matching categoryIds then deletes the category", () => {
    const categoryId = "cat1";
    const items = [
      { id: "a", categoryIds: ["cat1", "cat2"] },
      { id: "b", categoryIds: ["cat2"] },
      { id: "c", categoryIds: ["cat1"] },
    ];
    const categories = [{ id: "cat1" }, { id: "cat2" }];

    for (const item of items) {
      item.categoryIds = item.categoryIds.filter((id) => id !== categoryId);
    }
    const idx = categories.findIndex((c) => c.id === categoryId);
    assert.ok(idx >= 0);
    categories.splice(idx, 1);

    assert.deepEqual(
      items.map((i) => i.categoryIds),
      [["cat2"], ["cat2"], []],
    );
    assert.deepEqual(
      categories.map((c) => c.id),
      ["cat2"],
    );
  });
});
