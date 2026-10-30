import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCreateShopDrawingItemDto } from "./projectShopDrawing";

describe("parseCreateShopDrawingItemDto", () => {
  it("parses kode, name and ukuran, ignoring keterangan", () => {
    const dto = parseCreateShopDrawingItemDto({
      code: " sa3 ",
      name: "Hotel Logo",
      category: "",
      descriptions: "Aluminium box-up",
      dimension: "±  810 x 60 x 730",
    });
    assert.deepEqual(dto, {
      code: "SA3",
      name: "HOTEL LOGO",
      category: null,
      dimension: "± 810 x 60 x 730",
      mockupApproveDate: null,
    });
  });

  it("defaults the optional fields", () => {
    const dto = parseCreateShopDrawingItemDto({
      code: "SD1",
      name: "Sign",
    });
    assert.equal(dto.dimension, "");
    assert.equal(dto.mockupApproveDate, null);
  });

  it("parses mockup approve date when provided", () => {
    const dto = parseCreateShopDrawingItemDto({
      code: "SA1",
      name: "Sign",
      mockupApproveDate: "2026-03-15",
    });
    assert.equal(dto.mockupApproveDate, "2026-03-15");
  });

  it("requires a kode without spaces or dashes", () => {
    assert.throws(() => parseCreateShopDrawingItemDto({ name: "Sign" }), /code is required/);
    assert.throws(
      () => parseCreateShopDrawingItemDto({ code: "SA-1", name: "Sign" }),
      /cannot contain/,
    );
    assert.throws(
      () => parseCreateShopDrawingItemDto({ code: "SA 1", name: "Sign" }),
      /cannot contain/,
    );
  });
});
