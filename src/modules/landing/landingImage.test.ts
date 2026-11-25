import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { slugify } from "../../validation/landing";
import { toWebp } from "./landingImage";

describe("toWebp", () => {
  it("converts to WebP and caps the longest side without enlarging", async () => {
    const big = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: "#336699" },
    })
      .jpeg()
      .toBuffer();
    const out = await toWebp(big, "gallery");
    assert.equal(out.width, 2000);
    assert.equal(out.height, 1000);
    assert.equal((await sharp(out.buffer).metadata()).format, "webp");

    const small = await sharp({
      create: { width: 300, height: 200, channels: 4, background: "#00000000" },
    })
      .png()
      .toBuffer();
    const logo = await toWebp(small, "logo");
    assert.equal(logo.width, 300);
    assert.equal((await sharp(logo.buffer).metadata()).hasAlpha, true);
  });

  it("rejects a file that is not an image", async () => {
    await assert.rejects(toWebp(Buffer.from("not an image"), "cover"), /not an image/);
  });
});

describe("slugify", () => {
  it("builds a link name from a title", () => {
    assert.equal(slugify("Bali International Hospital"), "bali-international-hospital");
    assert.equal(slugify("  Commercial & Retail "), "commercial-and-retail");
  });
});
