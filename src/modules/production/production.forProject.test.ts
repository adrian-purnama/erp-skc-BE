import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { ProductionOrderRepo } from "../../models/productionOrder.model";
import { ProductionReportRepo } from "../../models/productionReport.model";
import { productionForProject } from "./production.forProject";
import { productionService } from "./production.service";

function query<T>(value: T) {
  const q = { select: () => q, lean: () => q, exec: async () => value };
  return q;
}

const oid = (n: number) => new Types.ObjectId(`6ae9bd7a2e3bbc05e91396${String(n).padStart(2, "0")}`);
const P = oid(1);
const ITEM = oid(2);
const LAB = oid(3);
const UOM = oid(4);
const LINE = `${ITEM}:${LAB}:${UOM}`;

const spk = (n: number, status: string, qty: string, extra: Record<string, unknown> = {}) => ({
  _id: oid(n),
  projectId: P,
  shopDrawingItemId: ITEM,
  labourItemId: LAB,
  labourUomId: UOM,
  labourName: "Las",
  role: "making",
  executor: "inhouse",
  status,
  qty,
  ...extra,
});

describe("productionForProject", () => {
  afterEach(() => mock.restoreAll());

  it("heldLabourLines: one entry per RAB line with the qty its SPKs hold", async () => {
    // A completed SPK holds only what it finished (3 of 5); a released one holds its qty (4).
    mock.method(ProductionOrderRepo.model, "find", () =>
      query([spk(10, "completed", "5"), spk(11, "released", "4")]),
    );
    mock.method(ProductionReportRepo.model, "find", () =>
      query([{ _id: oid(20), projectId: P, productionOrderId: oid(10), shopDrawingItemId: ITEM, qtyDone: "3", reportDate: "2026-11-01" }]),
    );
    assert.deepEqual(await productionForProject.heldLabourLines(String(P)), [
      {
        key: LINE,
        shopDrawingItemId: String(ITEM),
        labourName: "Las",
        role: "making",
        executor: "inhouse",
        heldQty: "7",
      },
    ]);
  });

  it("scheduleActuals: last SPK make qty wins; reports keyed to their line, orphans dropped", async () => {
    mock.method(ProductionOrderRepo.model, "find", () =>
      query([spk(10, "cancelled", "1", { snapshot: { makeQty: "8" } }), spk(11, "released", "2", { snapshot: { makeQty: "9" } })]),
    );
    mock.method(ProductionReportRepo.model, "find", () =>
      query([
        { _id: oid(21), projectId: P, productionOrderId: oid(10), shopDrawingItemId: ITEM, qtyDone: "1", reportDate: "2026-11-02" },
        { _id: oid(22), projectId: P, productionOrderId: oid(99), shopDrawingItemId: ITEM, qtyDone: "5", reportDate: "2026-11-03" },
      ]),
    );
    const actuals = await productionForProject.scheduleActuals(String(P));
    assert.deepEqual([...actuals.makeQtyByItem], [[String(ITEM), "9"]]);
    assert.deepEqual(actuals.reports, [{ itemId: String(ITEM), lineKey: LINE, date: "2026-11-02", qty: "1" }]);
  });

  it("summaryInputs: groups by project; % only for projects with SPKs; a failing % stays null", async () => {
    const Q = oid(5);
    mock.method(ProductionOrderRepo.model, "find", () =>
      query([spk(10, "released", "2", { plannedFinish: "2026-12-01" }), { ...spk(12, "released", "1"), projectId: Q }]),
    );
    mock.method(ProductionReportRepo.model, "find", () =>
      query([{ _id: oid(23), projectId: P, productionOrderId: oid(10), shopDrawingItemId: ITEM, qtyDone: "1", reportDate: "2026-11-04" }]),
    );
    mock.method(productionService, "progress", async (id: string) => {
      if (id === String(Q)) throw new Error("broken item");
      return { totals: { percent: 50 } } as never;
    });
    const out = await productionForProject.summaryInputs([String(P), String(Q)]);
    assert.deepEqual(out.get(String(P)), {
      orders: [{ qty: "2", plannedFinish: "2026-12-01" }],
      reportQtys: ["1"],
      productionPercent: 50,
    });
    assert.equal(out.get(String(Q))?.productionPercent, null);
  });
});
