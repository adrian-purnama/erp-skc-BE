import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import express from "express";
import {
  categoryFromFilePath,
  createRouter,
  getMountRecords,
  mountRouter,
  resetMountRecordsForTests,
} from "./routing";

describe("routing helpers", () => {
  beforeEach(() => {
    resetMountRecordsForTests();
  });

  it("derives category from route file names", () => {
    assert.equal(categoryFromFilePath("/x/example.routes.ts"), "example");
    assert.equal(categoryFromFilePath("/x/example.route.ts"), "example");
    assert.equal(categoryFromFilePath("/x/AppConfig.route.ts"), "AppConfig");
  });

  it("records nested mount paths and categories", () => {
    const app = express();
    const parent = createRouter();
    const child = createRouter();
    child.get("/item", (_req, res) => res.end());

    mountRouter(app, "/api", parent, "/tmp/api.routes.ts");
    mountRouter(parent, "/nested", child, "/tmp/nested.route.ts");

    const mounts = getMountRecords();
    assert.equal(mounts.length, 2);
    assert.equal(mounts[0]!.basePath, "/api");
    assert.equal(mounts[0]!.category, "api");
    assert.equal(mounts[1]!.basePath, "/api/nested");
    assert.equal(mounts[1]!.category, "nested");
  });
});
