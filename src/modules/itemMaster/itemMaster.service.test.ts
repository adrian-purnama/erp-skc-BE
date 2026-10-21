import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateUniqueFolderCode,
  buildItemId,
  pad4,
  parseCreateFolderDto,
  parseFolderCode,
  suggestFolderCodeFromName,
} from "../../validation/itemMaster";

describe("itemId helpers", () => {
  it("pads sequence to 4 digits", () => {
    assert.equal(pad4(1), "0001");
    assert.equal(pad4(42), "0042");
  });

  it("builds root and nested itemIds", () => {
    assert.equal(buildItemId([], 1), "0001");
    assert.equal(buildItemId(["RAW"], 1), "RAW/0001");
    assert.equal(buildItemId(["RAW", "STL"], 1), "RAW/STL/0001");
  });
});

describe("folder validation", () => {
  it("requires uppercase alphanumeric codes", () => {
    assert.equal(parseFolderCode("raw"), "RAW");
    assert.throws(() => parseFolderCode("raw-1"), /uppercase alphanumeric/);
    assert.throws(() => parseFolderCode(""), /required/);
  });

  it("parses create folder dto without code", () => {
    const dto = parseCreateFolderDto({
      name: "Raw materials",
      parentId: null,
    });
    assert.deepEqual(dto, {
      name: "Raw materials",
      parentId: null,
    });
  });

  it("suggests code from name and falls back when taken", () => {
    assert.equal(suggestFolderCodeFromName("Raw materials"), "RM");
    assert.equal(suggestFolderCodeFromName("Raw Materials Stock Room"), "RMSR");
    assert.equal(suggestFolderCodeFromName("Steel"), "STEE");
    assert.equal(suggestFolderCodeFromName("!!!"), "FLD");
    assert.equal(allocateUniqueFolderCode("RAW", []), "RAW");
    assert.equal(allocateUniqueFolderCode("RAW", ["raw"]), "RAW2");
    assert.equal(allocateUniqueFolderCode("RAW", ["RAW", "RAW2"]), "RAW3");
  });
});

describe("itemMaster move guards (pure)", () => {
  it("detects self and descendant targets via id set walk", () => {
    const parentOf: Record<string, string | null> = {
      a: null,
      b: "a",
      c: "b",
    };
    function isDescendantOf(candidateId: string, ancestorId: string): boolean {
      if (candidateId === ancestorId) return true;
      let current: string | null = candidateId;
      const seen = new Set<string>();
      while (current) {
        if (seen.has(current)) throw new Error("cycle");
        seen.add(current);
        if (current === ancestorId) return true;
        current = parentOf[current] ?? null;
      }
      return false;
    }

    assert.equal(isDescendantOf("a", "a"), true);
    assert.equal(isDescendantOf("c", "a"), true);
    assert.equal(isDescendantOf("a", "c"), false);
    assert.equal(isDescendantOf("b", "c"), false);
  });
});
