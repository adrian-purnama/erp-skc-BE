import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { PurchaseOrderRepo } from "../../models/purchaseOrder.model";
import { PurchaseRealizationRepo } from "../../models/purchaseRealization.model";
import { PurchaseRequestRepo } from "../../models/purchaseRequest.model";
import {
  countLivePurchasesForSpks,
  getPurchaseOrderLines,
  getPurchaseOrderNumbers,
  listSpkPurchaseOrders,
  realizedQtyByPoLine,
} from "./purchasing.public";

/** Chainable query stub: builder methods return itself, `exec` resolves `value`. */
function query<T>(value: T, calls: Array<[string, unknown]> = []) {
  const q = {
    select: (arg: unknown) => (calls.push(["select", arg]), q),
    sort: (arg: unknown) => (calls.push(["sort", arg]), q),
    lean: () => q,
    exec: async () => value,
  };
  return q;
}

const oid = (s: string) => new Types.ObjectId(s);
const SPK = "6ae9bd7a2e3bbc05e9139570";
const OTHER_SPK = "6ae9bd7a2e3bbc05e9139571";
const PO = "6ae9bd7a2e3bbc05e9139572";
const LINE_A = "6ae9bd7a2e3bbc05e9139573";
const LINE_B = "6ae9bd7a2e3bbc05e9139574";
const ITEM = "6ae9bd7a2e3bbc05e9139575";
const UOM = "6ae9bd7a2e3bbc05e9139576";
const VENDOR = "6ae9bd7a2e3bbc05e9139577";
const USER = "6ae9bd7a2e3bbc05e9139578";

describe("countLivePurchasesForSpks", () => {
  afterEach(() => mock.restoreAll());

  it("adds live SPPs (draft / submitted) and live POs on the SPKs", async () => {
    const filters: unknown[] = [];
    mock.method(PurchaseRequestRepo.model, "countDocuments", (f: unknown) => {
      filters.push(f);
      return query(2);
    });
    mock.method(PurchaseOrderRepo.model, "countDocuments", (f: unknown) => {
      filters.push(f);
      return query(3);
    });

    assert.equal(await countLivePurchasesForSpks([SPK]), 5);
    assert.deepEqual(filters, [
      { productionOrderId: { $in: [oid(SPK)] }, status: { $in: ["draft", "submitted"] } },
      {
        "lines.productionOrderId": { $in: [oid(SPK)] },
        status: { $in: ["draft", "pending_approval", "approved"] },
      },
    ]);
  });

  it("queries nothing for no SPKs", async () => {
    const req = mock.method(PurchaseRequestRepo.model, "countDocuments", () => query(9));
    assert.equal(await countLivePurchasesForSpks([]), 0);
    assert.equal(req.mock.callCount(), 0);
  });
});

describe("listSpkPurchaseOrders", () => {
  afterEach(() => mock.restoreAll());

  const doc = {
    _id: oid(PO),
    number: "PO/1",
    vendorId: oid(VENDOR),
    status: "approved",
    createdBy: oid(USER),
    lines: [
      { _id: oid(LINE_A), productionOrderId: oid(SPK), materialItemId: oid(ITEM), itemUomId: oid(UOM), qty: "2", unitPrice: "1000" },
      { _id: oid(LINE_B), productionOrderId: oid(OTHER_SPK), materialItemId: oid(ITEM), itemUomId: oid(UOM), qty: "5", unitPrice: "7" },
    ],
  };

  it("returns the SPK's POs with only that SPK's lines, newest first", async () => {
    const filters: unknown[] = [];
    const calls: Array<[string, unknown]> = [];
    mock.method(PurchaseOrderRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([doc], calls);
    });

    const pos = await listSpkPurchaseOrders(SPK, { sort: "newest" });

    assert.deepEqual(filters[0], { "lines.productionOrderId": oid(SPK) });
    assert.deepEqual(calls.find(([k]) => k === "sort"), ["sort", { createdAt: -1 }]);
    assert.deepEqual(pos, [
      {
        id: PO,
        number: "PO/1",
        vendorId: VENDOR,
        status: "approved",
        createdBy: USER,
        lines: [{ id: LINE_A, materialItemId: ITEM, itemUomId: UOM, qty: "2", unitPrice: "1000" }],
      },
    ]);
  });

  it("filters approved POs and sorts by approval when asked", async () => {
    const filters: unknown[] = [];
    const calls: Array<[string, unknown]> = [];
    mock.method(PurchaseOrderRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([], calls);
    });

    await listSpkPurchaseOrders(SPK, { approvedOnly: true, sort: "firstApproved" });

    assert.deepEqual(filters[0], { "lines.productionOrderId": oid(SPK), status: "approved" });
    assert.deepEqual(calls.find(([k]) => k === "sort"), ["sort", { approvedAt: 1 }]);
  });

  it("does not sort unless asked", async () => {
    const calls: Array<[string, unknown]> = [];
    mock.method(PurchaseOrderRepo.model, "find", () => query([], calls));
    await listSpkPurchaseOrders(SPK);
    assert.equal(calls.some(([k]) => k === "sort"), false);
  });
});

describe("realizedQtyByPoLine", () => {
  afterEach(() => mock.restoreAll());

  const docs = [
    { deliveredTo: "us", lines: [{ poLineId: oid(LINE_A), qty: "1.5" }, { poLineId: oid(LINE_B), qty: "9" }] },
    { deliveredTo: "vendor", lines: [{ poLineId: oid(LINE_A), qty: "2" }] },
    { lines: [{ poLineId: oid(LINE_A), qty: "0.5" }] },
  ];

  it("sums live (draft / posted) realizations per asked PO line, split by where they arrived", async () => {
    const filters: unknown[] = [];
    mock.method(PurchaseRealizationRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query(docs);
    });

    const sums = await realizedQtyByPoLine([LINE_A]);

    assert.deepEqual(filters[0], {
      "lines.poLineId": { $in: [oid(LINE_A)] },
      status: { $in: ["draft", "posted"] },
    });
    assert.deepEqual([...sums], [[LINE_A, { toUs: "2", toVendor: "2" }]]);
  });

  it("counts posted ones only and skips one realization when asked", async () => {
    const filters: unknown[] = [];
    mock.method(PurchaseRealizationRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([]);
    });

    await realizedQtyByPoLine([LINE_A], { postedOnly: true, exceptRealizationId: PO });

    assert.deepEqual(filters[0], {
      "lines.poLineId": { $in: [oid(LINE_A)] },
      status: { $in: ["posted"] },
      _id: { $ne: oid(PO) },
    });
  });

  it("queries nothing for no lines", async () => {
    const find = mock.method(PurchaseRealizationRepo.model, "find", () => query(docs));
    assert.equal((await realizedQtyByPoLine([])).size, 0);
    assert.equal(find.mock.callCount(), 0);
  });
});

describe("getPurchaseOrderNumbers", () => {
  afterEach(() => mock.restoreAll());

  it("maps PO id to number, ignoring empty ids", async () => {
    const filters: unknown[] = [];
    mock.method(PurchaseOrderRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([{ _id: oid(PO), number: "PO/1" }]);
    });

    const numbers = await getPurchaseOrderNumbers([PO, PO, null, undefined]);

    assert.deepEqual(filters[0], { _id: { $in: [oid(PO)] } });
    assert.deepEqual([...numbers], [[PO, "PO/1"]]);
  });
});

describe("getPurchaseOrderLines", () => {
  afterEach(() => mock.restoreAll());

  it("returns the PO's lines with their SPK, or null when there is no PO", async () => {
    mock.method(PurchaseOrderRepo.model, "findById", (id: unknown) =>
      query(
        String(id) === PO
          ? {
              _id: oid(PO),
              lines: [
                { _id: oid(LINE_A), productionOrderId: oid(SPK), materialItemId: oid(ITEM), itemUomId: oid(UOM), qty: "2", unitPrice: "1" },
                { _id: oid(LINE_B), productionOrderId: null, materialItemId: oid(ITEM), itemUomId: oid(UOM), qty: "3", unitPrice: "1" },
              ],
            }
          : null,
      ),
    );

    assert.deepEqual(await getPurchaseOrderLines(PO), [
      { id: LINE_A, productionOrderId: SPK, materialItemId: ITEM, itemUomId: UOM, qty: "2" },
      { id: LINE_B, productionOrderId: null, materialItemId: ITEM, itemUomId: UOM, qty: "3" },
    ]);
    assert.equal(await getPurchaseOrderLines(LINE_A), null);
  });
});
