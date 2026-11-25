import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { ProductionOrderRepo } from "../../models/productionOrder.model";
import { ProductionReportRepo } from "../../models/productionReport.model";
import {
  countLiveOrdersForShopDrawingItem,
  listProductionOrders,
  listValidReports,
} from "./production.public";

/** Chainable query stub: builder methods return itself, `exec` resolves `value`. */
function query<T>(value: T) {
  const q = { select: () => q, lean: () => q, exec: async () => value };
  return q;
}

const P = "6ae9bd7a2e3bbc05e9139570";
const ITEM = "6ae9bd7a2e3bbc05e9139571";

describe("listProductionOrders", () => {
  afterEach(() => mock.restoreAll());

  it("returns live SPKs only by default, as plain DTOs", async () => {
    const filters: unknown[] = [];
    mock.method(ProductionOrderRepo.model, "find", (filter: unknown) => {
      filters.push(filter);
      return query([
        {
          _id: new Types.ObjectId("6ae9bd7a2e3bbc05e9139576"),
          projectId: new Types.ObjectId(P),
          shopDrawingItemId: new Types.ObjectId(ITEM),
          labourItemId: new Types.ObjectId("6ae9bd7a2e3bbc05e9139572"),
          labourUomId: new Types.ObjectId("6ae9bd7a2e3bbc05e9139573"),
          role: "making",
          executor: "internal",
          status: "issued",
          qty: "2",
          snapshot: { makeQty: "5" },
        },
      ]);
    });

    const orders = await listProductionOrders([P]);

    assert.deepEqual(filters[0], {
      projectId: { $in: [new Types.ObjectId(P)] },
      status: { $ne: "cancelled" },
    });
    assert.deepEqual(orders, [
      {
        id: "6ae9bd7a2e3bbc05e9139576",
        projectId: P,
        shopDrawingItemId: ITEM,
        labourItemId: "6ae9bd7a2e3bbc05e9139572",
        labourUomId: "6ae9bd7a2e3bbc05e9139573",
        labourName: "",
        role: "making",
        executor: "internal",
        status: "issued",
        qty: "2",
        plannedFinish: null,
        makeQty: "5",
      },
    ]);
  });

  it("includes cancelled SPKs when asked", async () => {
    const filters: unknown[] = [];
    mock.method(ProductionOrderRepo.model, "find", (filter: unknown) => {
      filters.push(filter);
      return query([]);
    });
    await listProductionOrders([P], { includeCancelled: true });
    assert.deepEqual(filters[0], { projectId: { $in: [new Types.ObjectId(P)] } });
  });

  it("does not query for no valid project ids", async () => {
    const find = mock.method(ProductionOrderRepo.model, "find", () => query([]));
    assert.deepEqual(await listProductionOrders(["not-an-id"]), []);
    assert.equal(find.mock.callCount(), 0);
  });
});

describe("countLiveOrdersForShopDrawingItem", () => {
  afterEach(() => mock.restoreAll());

  it("counts non-cancelled SPKs on the item", async () => {
    const filters: unknown[] = [];
    mock.method(ProductionOrderRepo.model, "countDocuments", (filter: unknown) => {
      filters.push(filter);
      return { exec: async () => 3 };
    });
    assert.equal(await countLiveOrdersForShopDrawingItem(ITEM), 3);
    assert.deepEqual(filters[0], {
      shopDrawingItemId: new Types.ObjectId(ITEM),
      status: { $ne: "cancelled" },
    });
  });
});

describe("listValidReports", () => {
  afterEach(() => mock.restoreAll());

  it("filters out voided reports", async () => {
    const filters: unknown[] = [];
    mock.method(ProductionReportRepo.model, "find", (filter: unknown) => {
      filters.push(filter);
      return query([]);
    });
    await listValidReports({ projectIds: [P] });
    assert.deepEqual(filters[0], {
      isVoided: false,
      projectId: { $in: [new Types.ObjectId(P)] },
    });
  });

  it("does not query without a scope or with an empty one", async () => {
    const find = mock.method(ProductionReportRepo.model, "find", () => query([]));
    assert.deepEqual(await listValidReports({}), []);
    assert.deepEqual(await listValidReports({ orderIds: [] }), []);
    assert.equal(find.mock.callCount(), 0);
  });
});
