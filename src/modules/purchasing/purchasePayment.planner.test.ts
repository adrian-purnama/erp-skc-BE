import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkPaymentAmount,
  priceStage,
  shortfallBeforeCommit,
  sumAmounts,
} from "./purchasePayment.planner";

describe("priceStage", () => {
  it("prices percent on the payable, half up", () => {
    assert.equal(priceStage({ basis: "percent", rate: "30", amount: "0", base: "1000005" }), "300002");
  });

  it("keeps fixed amounts", () => {
    assert.equal(priceStage({ basis: "fixed", rate: null, amount: "250000", base: "1000000" }), "250000");
  });
});

describe("checkPaymentAmount", () => {
  const owed = "1000000";

  it("allows partial payments up to what is owed", () => {
    assert.deepEqual(
      checkPaymentAmount({ owed, stage: "partial", amount: "700000", others: [{ amount: "300000" }] }),
      { amount: "700000" },
    );
  });

  it("refuses going past what is owed", () => {
    assert.throws(
      () => checkPaymentAmount({ owed, stage: "partial", amount: "700001", others: [{ amount: "300000" }] }),
      /Only Rp 700000 is left/,
    );
  });

  it("refuses zero amounts", () => {
    assert.throws(() => checkPaymentAmount({ owed, stage: "partial", amount: "0", others: [] }), /greater than 0/);
  });

  it("pays the rest on full, upfront or after partials", () => {
    assert.deepEqual(checkPaymentAmount({ owed, stage: "full", amount: "0", others: [] }), { amount: "1000000" });
    assert.deepEqual(
      checkPaymentAmount({ owed: "1098000", stage: "full", amount: "0", others: [{ amount: "1000000" }] }),
      { amount: "98000" },
    );
  });

  it("refuses anything once nothing is left", () => {
    assert.throws(
      () => checkPaymentAmount({ owed, stage: "full", amount: "0", others: [{ amount: "1000000" }] }),
      /Nothing is left/,
    );
  });
});

describe("sumAmounts", () => {
  it("adds integer rupiah", () => {
    assert.equal(sumAmounts([{ amount: "100" }, { amount: "250" }]), "350");
  });
});

describe("shortfallBeforeCommit", () => {
  it("passes while approved + paid payments fit what is owed", () => {
    assert.equal(shortfallBeforeCommit({ amount: "40", owed: "100", committed: [{ amount: "60" }] }), null);
  });

  it("refuses a full payment after the invoice came in below the PO price", () => {
    // Full Rp 100 submitted on the PO estimate, invoice then posted at Rp 90.
    assert.equal(shortfallBeforeCommit({ amount: "100", owed: "90", committed: [] }), "90");
  });

  it("reports 0 left when other payments already took everything", () => {
    assert.equal(shortfallBeforeCommit({ amount: "10", owed: "100", committed: [{ amount: "120" }] }), "0");
  });
});
