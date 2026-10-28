import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocatedQty,
  assertOrderQty,
  assertReportQty,
  evaluateReadiness,
  maxOrderQty,
  percentOf,
  planMaterials,
  progressStatus,
  type ReadinessItemInput,
} from "./production.planner";

function item(overrides: Partial<ReadinessItemInput> = {}): ReadinessItemInput {
  return {
    itemId: "i1",
    code: "SA1",
    name: "PYLON",
    label: "SA1-PYLON",
    hasShopDrawing: true,
    hasBoq: true,
    makeQty: "2",
    hasProductionFile: true,
    ...overrides,
  };
}

describe("evaluateReadiness", () => {
  const base = {
    wonQuotation: { revision: 2, quotationNumber: "QUO/1/R2" },
    rabStatus: "locked" as const,
    rabChangeOpen: false,
  };

  it("is ready when quotation won, RAB locked and every item complete", () => {
    const r = evaluateReadiness({ ...base, items: [item(), item({ itemId: "i2" })] });
    assert.equal(r.ready, true);
    assert.equal(r.readyCount, 2);
    assert.ok(r.checks.every((c) => c.ok));
  });

  it("flags each missing piece per item", () => {
    const r = evaluateReadiness({
      ...base,
      items: [
        item(),
        item({ itemId: "i2", hasProductionFile: false }),
        item({ itemId: "i3", hasShopDrawing: false, hasBoq: false, makeQty: null }),
      ],
    });
    assert.equal(r.ready, false);
    assert.equal(r.readyCount, 1);
    assert.equal(r.items[1]!.productionFile, false);
    assert.equal(r.items[2]!.shopDrawing, false);
    assert.equal(r.items[2]!.boq, false);
    assert.equal(r.checks.find((c) => c.key === "items")!.ok, false);
  });

  it("treats a zero make qty as no BOQ", () => {
    const r = evaluateReadiness({ ...base, items: [item({ makeQty: "0" })] });
    assert.equal(r.items[0]!.boq, false);
    assert.equal(r.ready, false);
  });

  it("needs a won quotation and a locked RAB with no open change", () => {
    assert.equal(
      evaluateReadiness({ ...base, wonQuotation: null, items: [item()] }).ready,
      false,
    );
    assert.equal(
      evaluateReadiness({ ...base, rabChangeOpen: true, items: [item()] }).ready,
      false,
    );
    assert.equal(
      evaluateReadiness({ ...base, rabStatus: "draft", items: [item()] }).ready,
      false,
    );
  });

  it("is not ready with no items", () => {
    assert.equal(evaluateReadiness({ ...base, items: [] }).ready, false);
  });
});

describe("qty cap", () => {
  const orders = [
    { id: "a", status: "released" as const, qty: "4" },
    { id: "b", status: "cancelled" as const, qty: "3" },
    { id: "c", status: "completed" as const, qty: "3" },
    { id: "d", status: "draft" as const, qty: "1" },
  ];
  const done = new Map([["c", "2"]]);

  it("counts open qty, completed done qty, and ignores cancelled", () => {
    assert.equal(allocatedQty(orders, done).toString(), "7");
  });

  it("frees qty from the edited order", () => {
    assert.equal(maxOrderQty("10", orders, done, "a").toString(), "7");
    assert.equal(maxOrderQty("10", orders, done).toString(), "3");
  });

  it("never goes below zero", () => {
    assert.equal(maxOrderQty("5", orders, done).toString(), "0");
  });

  it("rejects qty over the free amount", () => {
    assert.throws(() => assertOrderQty("4", maxOrderQty("10", orders, done)), /still free/);
    assert.doesNotThrow(() => assertOrderQty("3", maxOrderQty("10", orders, done)));
  });
});

describe("assertReportQty", () => {
  it("allows up to what is left on the SPK", () => {
    assert.doesNotThrow(() => assertReportQty("2", "5", "3"));
    assert.throws(() => assertReportQty("3", "5", "3"), /left on this SPK/);
    assert.throws(() => assertReportQty("0", "5", "0"), /greater than 0/);
  });
});

describe("planMaterials", () => {
  it("sums per material×UOM and scales by SPK qty", () => {
    const rows = planMaterials(
      {
        makeQty: "10",
        main: {
          parts: [
            {
              bases: [
                {
                  materialItemId: "ply",
                  itemUomId: "sheet",
                  qtyPerUnit: "0.5",
                  finishings: [
                    { lines: [{ materialItemId: "paint", itemUomId: "l", qtyPerUnit: "0.2" }] },
                  ],
                },
              ],
            },
          ],
          assembly: { lines: [{ materialItemId: "ply", itemUomId: "sheet", qtyPerUnit: "0.25" }] },
        },
      },
      "4",
    );
    const ply = rows.find((r) => r.materialItemId === "ply")!;
    assert.equal(ply.qtyPerUnit, "0.75");
    assert.equal(ply.qty, "3");
    assert.equal(rows.find((r) => r.materialItemId === "paint")!.qty, "0.8");
  });
});

describe("progress", () => {
  it("maps qty to a status", () => {
    assert.equal(progressStatus({ makeQty: "5", orderedQty: "0", doneQty: "0" }), "not_started");
    assert.equal(progressStatus({ makeQty: "5", orderedQty: "3", doneQty: "0" }), "partial");
    assert.equal(progressStatus({ makeQty: "5", orderedQty: "5", doneQty: "2" }), "in_progress");
    assert.equal(progressStatus({ makeQty: "5", orderedQty: "5", doneQty: "5" }), "done");
  });

  it("rounds and clamps percent", () => {
    assert.equal(percentOf("1", "3"), 33);
    assert.equal(percentOf("4", "0"), 0);
    assert.equal(percentOf("6", "5"), 100);
  });
});
