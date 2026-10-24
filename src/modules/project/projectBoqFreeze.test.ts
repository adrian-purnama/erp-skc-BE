import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import {
  assertBoqAppendOnly,
  boqHasAdditions,
  jakartaDateKey,
  stampBoqAdditions,
  type BoqSnapshot,
} from "./projectBoqFreeze";

const mid = () => new Types.ObjectId();
const m1 = mid();
const u1 = mid();
const m2 = mid();
const u2 = mid();

function line(
  materialItemId: Types.ObjectId,
  itemUomId: Types.ObjectId,
  qty = "1",
) {
  return {
    materialItemId,
    itemUomId,
    formula: "v1",
    inputs: { v1: qty },
    qtyPerUnit: qty,
  };
}

function snap(partial?: Partial<BoqSnapshot>): BoqSnapshot {
  return {
    makeQty: "1",
    main: {
      parts: [
        {
          key: "p1",
          bases: [
            {
              key: "b1",
              ...line(m1, u1, "2"),
              finishings: [],
            },
          ],
        },
      ],
      assembly: { lines: [] },
    },
    lighting: { lines: [] },
    mounting: { type: "mounted", lines: [] },
    other: { lines: [] },
    ...partial,
  };
}

describe("assertBoqAppendOnly", () => {
  it("rejects frozen qty changes", () => {
    const previous = snap();
    const next = snap({
      main: {
        parts: [
          {
            key: "p1",
            bases: [
              {
                key: "b1",
                ...line(m1, u1, "9"),
                finishings: [],
              },
            ],
          },
        ],
        assembly: { lines: [] },
      },
    });
    assert.throws(
      () => assertBoqAppendOnly(previous, next),
      /cannot change frozen core/,
    );
  });

  it("rejects makeQty changes", () => {
    assert.throws(
      () => assertBoqAppendOnly(snap(), snap({ makeQty: "2" })),
      /makeQty/,
    );
  });

  it("allows appending a new assembly line", () => {
    const previous = snap();
    const next = snap({
      main: {
        ...previous.main,
        assembly: { lines: [line(m2, u2, "1")] },
      },
    });
    assert.doesNotThrow(() => assertBoqAppendOnly(previous, next));
    assert.equal(boqHasAdditions(previous, next), true);
  });
});

describe("stampBoqAdditions", () => {
  it("stamps only new lines and preserves frozen stamps", () => {
    const previous = snap();
    const next = snap({
      main: {
        ...previous.main,
        assembly: { lines: [line(m2, u2, "3")] },
      },
    });
    const stamp = {
      addedAt: new Date("2026-10-23T03:00:00.000Z"),
      addedBy: mid(),
      addReason: "site change",
    };
    const stamped = stampBoqAdditions(previous, next, stamp);
    assert.equal(stamped.main.assembly.lines.length, 1);
    assert.equal(stamped.main.assembly.lines[0]!.addReason, "site change");
    assert.equal(stamped.main.parts[0]!.bases[0]!.addReason, undefined);
  });
});

describe("jakartaDateKey", () => {
  it("groups by Asia/Jakarta calendar day", () => {
    // 22 Oct 2026 17:00 UTC = 23 Oct 2026 00:00 Jakarta
    assert.equal(
      jakartaDateKey("2026-10-22T17:00:00.000Z"),
      "2026-10-23",
    );
    assert.equal(
      jakartaDateKey("2026-10-22T16:59:00.000Z"),
      "2026-10-22",
    );
  });
});
