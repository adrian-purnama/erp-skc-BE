import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkVendorStage,
  priceStage,
  reimbursementOutcome,
  sumAmounts,
  vendorPayable,
} from "./purchasePayment.planner";

describe("vendorPayable", () => {
  it("uses the estimate less staff purchases until fully received", () => {
    assert.deepEqual(
      vendorPayable({
        estimatedTotal: "1110000",
        staffRealizedTotal: "110000",
        vendorRealizedTotal: "500000",
        fullyReceived: false,
      }),
      { base: "1000000", final: false },
    );
  });

  it("uses the actual vendor receipts once fully received", () => {
    assert.deepEqual(
      vendorPayable({
        estimatedTotal: "1110000",
        staffRealizedTotal: "0",
        vendorRealizedTotal: "1098000",
        fullyReceived: true,
      }),
      { base: "1098000", final: true },
    );
  });

  it("never goes below zero", () => {
    assert.equal(
      vendorPayable({ estimatedTotal: "100", staffRealizedTotal: "200", vendorRealizedTotal: "0", fullyReceived: false }).base,
      "0",
    );
  });
});

describe("priceStage", () => {
  it("prices percent on the payable, half up", () => {
    assert.equal(priceStage({ basis: "percent", rate: "30", amount: "0", base: "1000005" }), "300002");
  });

  it("keeps fixed amounts", () => {
    assert.equal(priceStage({ basis: "fixed", rate: null, amount: "250000", base: "1000000" }), "250000");
  });
});

describe("checkVendorStage", () => {
  const base = { base: "1000000", final: false };

  it("allows stages up to the payable", () => {
    assert.deepEqual(
      checkVendorStage({ ...base, stage: "termin", amount: "700000", others: [{ stage: "dp", amount: "300000" }] }),
      { amount: "700000" },
    );
  });

  it("refuses going past the payable", () => {
    assert.throws(
      () => checkVendorStage({ ...base, stage: "termin", amount: "700001", others: [{ stage: "dp", amount: "300000" }] }),
      /Only Rp 700000 is left/,
    );
  });

  it("refuses zero amounts", () => {
    assert.throws(() => checkVendorStage({ ...base, stage: "dp", amount: "0", others: [] }), /greater than 0/);
  });

  it("allows pelunasan only when final, settling the rest", () => {
    assert.throws(
      () => checkVendorStage({ ...base, stage: "pelunasan", amount: "0", others: [] }),
      /once everything on the PO is received/,
    );
    assert.deepEqual(
      checkVendorStage({
        base: "1098000",
        final: true,
        stage: "pelunasan",
        amount: "0",
        others: [{ stage: "dp", amount: "300000" }],
      }),
      { amount: "798000" },
    );
  });

  it("refuses pelunasan with nothing left, and anything after pelunasan", () => {
    assert.throws(
      () =>
        checkVendorStage({ base: "300000", final: true, stage: "pelunasan", amount: "0", others: [{ stage: "dp", amount: "300000" }] }),
      /Nothing is left/,
    );
    assert.throws(
      () => checkVendorStage({ ...base, stage: "termin", amount: "1", others: [{ stage: "pelunasan", amount: "5" }] }),
      /already has its pelunasan/,
    );
  });
});

describe("reimbursementOutcome", () => {
  it("waits while a nota is pending", () => {
    assert.deepEqual(
      reimbursementOutcome([
        { status: "approved", amount: "100" },
        { status: "pending", amount: "50" },
      ]),
      { status: "pending_approval", amount: "100" },
    );
  });

  it("pays the approved notas only", () => {
    assert.deepEqual(
      reimbursementOutcome([
        { status: "approved", amount: "100" },
        { status: "rejected", amount: "50" },
      ]),
      { status: "approved", amount: "100" },
    );
  });

  it("is rejected when every nota is rejected", () => {
    assert.deepEqual(reimbursementOutcome([{ status: "rejected", amount: "50" }]), {
      status: "rejected",
      amount: "0",
    });
  });
});

describe("sumAmounts", () => {
  it("adds integer rupiah", () => {
    assert.equal(sumAmounts([{ amount: "100" }, { amount: "250" }]), "350");
  });
});
