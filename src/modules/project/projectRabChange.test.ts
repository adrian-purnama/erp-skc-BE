import assert from "node:assert/strict";
import { productionConflicts } from "./projectRabChange.planner";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import type { ProjectRabLine } from "../../models/projectRab.model";
import {
  diffBoqFiles,
  diffBoqMaterialContributions,
  diffCurrentFiles,
  diffRabLines,
  filterCountedBoqs,
  syncRabLinesFromBoqs,
} from "./projectRabChange.planner";

const m1 = new Types.ObjectId();
const u1 = new Types.ObjectId();
const m2 = new Types.ObjectId();
const u2 = new Types.ObjectId();

describe("syncRabLinesFromBoqs", () => {
  it("rebuilds material qty from BOQ snaps and keeps prices/labour", () => {
    const previous: ProjectRabLine[] = [
      {
        key: `${String(m1)}:${String(u1)}`,
        materialItemId: m1,
        itemUomId: u1,
        totalQty: "1",
        unitPrice: "1000",
        origin: "lock",
      },
      {
        key: `${String(m2)}:${String(u2)}`,
        materialItemId: m2,
        itemUomId: u2,
        totalQty: "5",
        unitPrice: "500",
        origin: "labour",
      },
    ];

    const boqs = [
      {
        shopDrawingItemId: new Types.ObjectId(),
        shopDrawingFileId: new Types.ObjectId(),
        makeQty: "2",
        main: {
          parts: [
            {
              key: "p1",
              bases: [
                {
                  key: "b1",
                  materialItemId: m1,
                  itemUomId: u1,
                  formula: "v1",
                  inputs: { v1: "3" },
                  qtyPerUnit: "3",
                  finishings: [],
                },
              ],
            },
          ],
          assembly: { lines: [] },
        },
        lighting: { lines: [] },
        mounting: { type: "mounted" as const, lines: [] },
        other: { lines: [] },
      },
    ];

    const next = syncRabLinesFromBoqs(boqs, previous);
    const material = next.find((l) => l.origin !== "labour");
    const labour = next.find((l) => l.origin === "labour");
    assert.ok(material);
    assert.equal(material!.totalQty, "6"); // 3 * 2
    assert.equal(material!.unitPrice, "1000");
    assert.ok(labour);
    assert.equal(labour!.unitPrice, "500");
  });

  it("drops materials removed from BOQs but keeps labour", () => {
    const previous: ProjectRabLine[] = [
      {
        key: `${String(m1)}:${String(u1)}`,
        materialItemId: m1,
        itemUomId: u1,
        totalQty: "1",
        unitPrice: "1000",
        origin: "lock",
      },
      {
        key: `${String(m2)}:${String(u2)}`,
        materialItemId: m2,
        itemUomId: u2,
        totalQty: "1",
        origin: "labour",
      },
    ];
    const next = syncRabLinesFromBoqs([], previous);
    assert.equal(next.length, 1);
    assert.equal(next[0]!.origin, "labour");
  });
});

describe("diffRabLines", () => {
  it("detects added, removed, and changed lines", () => {
    const k1 = `${String(m1)}:${String(u1)}`;
    const k2 = `${String(m2)}:${String(u2)}`;
    const baseline: ProjectRabLine[] = [
      {
        key: k1,
        materialItemId: m1,
        itemUomId: u1,
        totalQty: "10",
        unitPrice: "100",
        origin: "lock",
      },
      {
        key: k2,
        materialItemId: m2,
        itemUomId: u2,
        totalQty: "1",
        unitPrice: "50",
        origin: "lock",
      },
    ];
    const next: ProjectRabLine[] = [
      {
        key: k1,
        materialItemId: m1,
        itemUomId: u1,
        totalQty: "12",
        unitPrice: "100",
        origin: "lock",
      },
      {
        key: "new:key",
        materialItemId: m1,
        itemUomId: u2,
        totalQty: "3",
        unitPrice: "200",
        origin: "append",
      },
    ];
    const diff = diffRabLines(baseline, next);
    assert.equal(diff.find((d) => d.key === k1)?.kind, "changed");
    assert.equal(diff.find((d) => d.key === k2)?.kind, "removed");
    assert.equal(diff.find((d) => d.key === "new:key")?.kind, "added");
  });
});

describe("diffBoqFiles", () => {
  it("detects BOQs added and removed by file id", () => {
    const itemA = new Types.ObjectId();
    const fileA = new Types.ObjectId();
    const itemB = new Types.ObjectId();
    const fileB = new Types.ObjectId();
    const fileC = new Types.ObjectId();
    const diff = diffBoqFiles(
      [
        { shopDrawingItemId: itemA, shopDrawingFileId: fileA },
        { shopDrawingItemId: itemB, shopDrawingFileId: fileB },
      ],
      [
        { shopDrawingItemId: itemA, shopDrawingFileId: fileA },
        { shopDrawingItemId: itemB, shopDrawingFileId: fileC },
      ],
    );
    assert.ok(diff.some((d) => d.shopDrawingFileId === String(fileC) && d.kind === "added"));
    assert.ok(diff.some((d) => d.shopDrawingFileId === String(fileB) && d.kind === "removed"));
  });
});

describe("diffBoqMaterialContributions", () => {
  it("only marks the shop drawing file whose material qty changed", () => {
    const itemEvac = new Types.ObjectId();
    const fileEvac = new Types.ObjectId();
    const itemExit = new Types.ObjectId();
    const fileExit = new Types.ObjectId();
    const key = `${String(m1)}:${String(u1)}`;

    const emptyMain = {
      parts: [
        {
          key: "p1",
          bases: [
            {
              key: "b1",
              materialItemId: m1,
              itemUomId: u1,
              qtyPerUnit: "1",
              formula: "v1",
              inputs: { v1: "1" },
              finishings: [],
            },
          ],
        },
      ],
      assembly: { lines: [] },
    };

    const baseline = [
      {
        shopDrawingItemId: itemEvac,
        shopDrawingFileId: fileEvac,
        makeQty: "10",
        main: {
          ...emptyMain,
          parts: [
            {
              key: "p1",
              bases: [
                {
                  key: "b1",
                  materialItemId: m1,
                  itemUomId: u1,
                  qtyPerUnit: "0.5",
                  formula: "v1",
                  inputs: { v1: "1" },
                  finishings: [],
                },
              ],
            },
          ],
        },
        lighting: { lines: [] },
        mounting: { type: "mounted" as const, lines: [] },
        other: { lines: [] },
      },
      {
        shopDrawingItemId: itemExit,
        shopDrawingFileId: fileExit,
        makeQty: "50",
        main: {
          ...emptyMain,
          parts: [
            {
              key: "p1",
              bases: [
                {
                  key: "b1",
                  materialItemId: m1,
                  itemUomId: u1,
                  qtyPerUnit: "2.1",
                  formula: "v1",
                  inputs: { v1: "1" },
                  finishings: [],
                },
              ],
            },
          ],
        },
        lighting: { lines: [] },
        mounting: { type: "mounted" as const, lines: [] },
        other: { lines: [] },
      },
    ];

    const next = [
      baseline[0]!,
      {
        ...baseline[1]!,
        main: {
          ...emptyMain,
          parts: [
            {
              key: "p1",
              bases: [
                {
                  key: "b1",
                  materialItemId: m1,
                  itemUomId: u1,
                  qtyPerUnit: "1.1",
                  formula: "v1",
                  inputs: { v1: "1" },
                  finishings: [],
                },
              ],
            },
          ],
        },
      },
    ];

    const diff = diffBoqMaterialContributions(baseline, next);
    assert.equal(diff.length, 1);
    assert.equal(diff[0]!.shopDrawingFileId, String(fileExit));
    assert.equal(diff[0]!.key, key);
    assert.equal(diff[0]!.kind, "changed");
    assert.equal(diff[0]!.oldTotalQty, "105");
    assert.equal(diff[0]!.newTotalQty, "55");
  });
});

describe("change continuity", () => {
  const itemA = new Types.ObjectId();
  const v1 = new Types.ObjectId();
  const v2 = new Types.ObjectId();
  const boq = (fileId: Types.ObjectId, qty: string) => ({
    shopDrawingItemId: itemA,
    shopDrawingFileId: fileId,
    makeQty: "1",
    other: {
      lines: [
        {
          materialItemId: m1,
          itemUomId: u1,
          formula: "v1",
          inputs: { v1: qty },
          qtyPerUnit: qty,
        },
      ],
    },
  });

  it("keeps addReason of lines added by an earlier change", () => {
    const previous: ProjectRabLine[] = [
      {
        key: `${String(m1)}:${String(u1)}`,
        materialItemId: m1,
        itemUomId: u1,
        totalQty: "1",
        unitPrice: "10",
        origin: "append",
        addedAt: new Date("2026-01-01"),
        addedBy: u2,
        addReason: "Client added a sign",
      },
    ];
    const next = syncRabLinesFromBoqs([boq(v1, "3")], previous);
    assert.equal(next[0]!.totalQty, "3");
    assert.equal(next[0]!.origin, "append");
    assert.equal(next[0]!.addReason, "Client added a sign");
  });

  it("counts only the current file version of each item", () => {
    const boqs = [boq(v1, "2"), boq(v2, "5")];
    const counted = filterCountedBoqs(boqs, [
      { shopDrawingItemId: itemA, shopDrawingFileId: v2 },
    ]);
    assert.deepEqual(counted.map((b) => String(b.shopDrawingFileId)), [String(v2)]);
    const lines = syncRabLinesFromBoqs(counted, []);
    assert.equal(lines[0]!.totalQty, "5");
    // Unknown (legacy) current map keeps every BOQ.
    assert.equal(filterCountedBoqs(boqs, null).length, 2);
  });

  it("reports version switches per item", () => {
    const itemB = new Types.ObjectId();
    const b1 = new Types.ObjectId();
    const diff = diffCurrentFiles(
      [
        { shopDrawingItemId: itemA, shopDrawingFileId: v1 },
        { shopDrawingItemId: itemB, shopDrawingFileId: b1 },
      ],
      [
        { shopDrawingItemId: itemA, shopDrawingFileId: v2 },
        { shopDrawingItemId: itemB, shopDrawingFileId: b1 },
      ],
    );
    assert.deepEqual(diff, [
      {
        shopDrawingItemId: String(itemA),
        fromFileId: String(v1),
        toFileId: String(v2),
      },
    ]);
  });
});

describe("productionConflicts", () => {
  it("allows changes that leave live SPKs their qty", () => {
    assert.deepEqual(
      productionConflicts([
        { label: "SA1-PYLON", heldQty: "4", nextMakeQty: "10" },
        { label: "SA2-SIGN", heldQty: "0", nextMakeQty: null },
      ]),
      [],
    );
  });

  it("refuses removing an item with SPKs", () => {
    const out = productionConflicts([{ label: "SA1-PYLON", heldQty: "4", nextMakeQty: null }]);
    assert.match(out[0]!, /SA1-PYLON has SPKs/);
  });

  it("refuses a make qty below what SPKs hold", () => {
    const out = productionConflicts([{ label: "SA1-PYLON", heldQty: "6", nextMakeQty: "5" }]);
    assert.match(out[0]!, /make qty 5 is below the 6/);
  });
});
