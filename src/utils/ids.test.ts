import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { uniqueIdsExcept } from "./ids";

describe("uniqueIdsExcept", () => {
  it("dedupes ObjectIds and strings by value", () => {
    const a = new Types.ObjectId();
    const out = uniqueIdsExcept([a, String(a), new Types.ObjectId(a.toHexString())], "x");
    assert.deepEqual(out, [String(a)]);
  });

  it("drops null, undefined and the excluded id", () => {
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    assert.deepEqual(uniqueIdsExcept([a, null, b, undefined], String(a)), [String(b)]);
  });

  it("returns an empty list for no input", () => {
    assert.deepEqual(uniqueIdsExcept([], "x"), []);
  });
});
