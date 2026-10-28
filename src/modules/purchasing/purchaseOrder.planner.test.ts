import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";
import {
  checkOrderLines,
  lineAmount,
  remainingToOrder,
  requestLineOrderStatus,
  requestOrderStatus,
  sumOrdered,
  type OrderLineInput,
  type RequestLineRef,
} from "./purchaseOrder.planner";

const REF: RequestLineRef = {
  requestId: "r1",
  requestLineId: "l1",
  requestNumber: "SPP/X/2026/0001",
  requestStatus: "submitted",
  label: "Plate 2mm",
  qty: "10",
};

function line(overrides: Partial<OrderLineInput> = {}): OrderLineInput {
  return { requestLineId: "l1", qty: "4", unitPrice: "150000", note: "", ...overrides };
}

function check(
  lines: OrderLineInput[],
  opts: { ref?: Partial<RequestLineRef>; ordered?: string } = {},
) {
  return checkOrderLines({
    requestId: "r1",
    lines,
    requestLines: new Map([["l1", { ...REF, ...opts.ref }]]),
    orderedElsewhere: new Map(opts.ordered ? [["l1", new Decimal(opts.ordered)]] : []),
  });
}

describe("sumOrdered / remaining / status", () => {
  it("sums per SPP line and never goes below 0", () => {
    const sums = sumOrdered([
      { requestLineId: "l1", qty: "3" },
      { requestLineId: "l1", qty: "2.5" },
    ]);
    assert.equal(sums.get("l1")?.toString(), "5.5");
    assert.equal(remainingToOrder("5", new Decimal(7)).toString(), "0");
  });

  it("tells open / partial / ordered per line and per request", () => {
    assert.equal(requestLineOrderStatus("10", undefined), "open");
    assert.equal(requestLineOrderStatus("10", new Decimal(4)), "partial");
    assert.equal(requestLineOrderStatus("10", new Decimal(12)), "ordered");
    assert.equal(requestOrderStatus(["open", "open"]), "open");
    assert.equal(requestOrderStatus(["ordered", "open"]), "partial");
    assert.equal(requestOrderStatus(["ordered", "ordered"]), "ordered");
  });
});

describe("lineAmount", () => {
  it("rounds to whole rupiah", () => {
    assert.equal(lineAmount("1.5", "333").toFixed(0), "500");
  });
});

describe("checkOrderLines", () => {
  it("computes amounts and total", () => {
    const out = check([line()]);
    assert.equal(out.lines[0]!.amount, "600000");
    assert.equal(out.total, "600000");
    assert.equal(out.lines[0]!.overRequest, false);
  });

  it("requires at least one line", () => {
    assert.throws(() => check([]), /at least one/);
  });

  it("rejects the same SPP line twice", () => {
    assert.throws(() => check([line(), line()]), /twice/);
  });

  it("rejects lines from another SPP", () => {
    assert.throws(() => check([line()], { ref: { requestId: "r2" } }), /one SPP only/);
  });

  it("rejects lines of an SPP that is not submitted", () => {
    assert.throws(() => check([line()], { ref: { requestStatus: "cancelled" } }), /no longer open/);
  });

  it("rejects fully ordered SPP lines", () => {
    assert.throws(() => check([line()], { ordered: "10" }), /fully ordered/);
  });

  it("allows rounding up past what is left, and flags it", () => {
    const out = check([line({ qty: "8" })], { ordered: "6" });
    assert.equal(out.lines[0]!.overRequest, true);
  });

  it("needs a positive qty and price", () => {
    assert.throws(() => check([line({ qty: "0" })]), /greater than 0/);
    assert.throws(() => check([line({ unitPrice: "0" })]), /unit price/);
  });
});
