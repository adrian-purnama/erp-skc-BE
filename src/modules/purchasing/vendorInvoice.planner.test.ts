import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";
import { checkInvoiceLines, priceVendorReceipts, shareByWeight } from "./vendorInvoice.planner";

const poLines = [{ id: "pl1", qty: "10", unitPrice: "100000" }];
const ppn = { category: "tax" as const, label: "PPN", kind: "percent" as const, rate: "11", amount: "0" };
const ongkir = { category: "delivery" as const, label: "Ongkir", kind: "fixed" as const, rate: null, amount: "200001" };

function gr(id: string, qty: string, invoiceId: string | null = null) {
  return { id, method: "vendor" as const, lines: [{ id: `${id}-l`, poLineId: "pl1", qty }], invoiceId };
}

describe("shareByWeight", () => {
  it("adds up exactly when the slices cover the whole", () => {
    const shares = shareByWeight("200001", [new Decimal(1), new Decimal(1), new Decimal(1)], new Decimal(3));
    assert.deepEqual(shares, ["66667", "66667", "66667"]);
    assert.equal(shares.reduce((s, x) => s + Number(x), 0), 200001);
  });

  it("gives a part when the slices cover part", () => {
    assert.deepEqual(shareByWeight("1000", [new Decimal(5)], new Decimal(10)), ["500"]);
  });

  it("is zero for an empty whole", () => {
    assert.deepEqual(shareByWeight("1000", [new Decimal(5)], new Decimal(0)), ["0"]);
  });
});

describe("priceVendorReceipts", () => {
  const base = { poLines, poCharges: [ppn, ongkir], closedPartial: false, invoices: [] };

  it("owes the PO estimate before anything arrives", () => {
    const r = priceVendorReceipts({ ...base, receipts: [] });
    assert.equal(r.vendorOwed, String(1_000_000 + 110_000 + 200_001));
    assert.equal(r.notYetReceived, r.vendorOwed);
  });

  it("prices GRs without an invoice at the PO, and the owed amount never jumps", () => {
    const half = priceVendorReceipts({ ...base, receipts: [gr("g1", "5")] });
    const g1 = half.receipts.get("g1")!;
    assert.equal(g1.invoiced, false);
    assert.equal(g1.subtotal, "500000");
    assert.equal(g1.chargesTotal, String(55_000 + 100_001));
    assert.equal(half.vendorOwed, "1310001");
    const all = priceVendorReceipts({ ...base, receipts: [gr("g1", "5"), gr("g2", "5")] });
    assert.equal(all.notYetReceived, "0");
    assert.equal(all.vendorOwed, "1310001");
  });

  it("uses the invoice price and charges once invoiced", () => {
    const r = priceVendorReceipts({
      ...base,
      receipts: [gr("g1", "5", "i1"), gr("g2", "5")],
      invoices: [
        {
          id: "i1",
          realizationIds: ["g1"],
          lines: [{ realizationLineId: "g1-l", unitPrice: "110000" }],
          charges: [{ ...ppn }, { ...ongkir, amount: "150000" }],
        },
      ],
    });
    const g1 = r.receipts.get("g1")!;
    assert.equal(g1.invoiced, true);
    assert.equal(g1.subtotal, "550000");
    assert.equal(g1.chargesTotal, String(60_500 + 150_000));
    // g2 still at the PO: 500000 + its PPN and ongkir share.
    assert.equal(r.receipts.get("g2")!.total, String(500_000 + 55_000 + 100_000));
    assert.equal(r.vendorOwed, String(760_500 + 655_000));
  });

  it("shares one invoice's charges over its GRs", () => {
    const r = priceVendorReceipts({
      ...base,
      receipts: [gr("g1", "4", "i1"), gr("g2", "6", "i1")],
      invoices: [
        {
          id: "i1",
          realizationIds: ["g1", "g2"],
          lines: [
            { realizationLineId: "g1-l", unitPrice: "100000" },
            { realizationLineId: "g2-l", unitPrice: "100000" },
          ],
          charges: [{ ...ongkir, amount: "100000" }],
        },
      ],
    });
    assert.equal(r.receipts.get("g1")!.chargesTotal, "40000");
    assert.equal(r.receipts.get("g2")!.chargesTotal, "60000");
    assert.equal(r.vendorOwed, "1100000");
  });

  it("drops what never arrived on a closed-partial PO", () => {
    const r = priceVendorReceipts({ ...base, closedPartial: true, receipts: [gr("g1", "5")] });
    assert.equal(r.notYetReceived, "0");
    assert.equal(r.vendorOwed, String(500_000 + 55_000 + 100_001));
  });

  it("does not owe the vendor for what staff bought", () => {
    const staff = { id: "n1", method: "staff" as const, lines: [{ id: "n1-l", poLineId: "pl1", qty: "5" }], invoiceId: null };
    const r = priceVendorReceipts({ ...base, poCharges: [], receipts: [staff] });
    assert.equal(r.receipts.has("n1"), false);
    assert.equal(r.vendorOwed, "500000");
  });
});

describe("checkInvoiceLines", () => {
  const receiptLines = [{ realizationLineId: "a", poLineId: "pl1", qty: "2", label: "Cement" }];

  it("prices every receipt line", () => {
    assert.deepEqual(
      checkInvoiceLines({ receiptLines, lines: [{ realizationLineId: "a", unitPrice: "1500", note: " x " }] }),
      { lines: [{ ...receiptLines[0]!, unitPrice: "1500", note: "x" }], subtotal: "3000" },
    );
  });

  it("refuses missing, zero, twice and foreign lines", () => {
    assert.throws(() => checkInvoiceLines({ receiptLines, lines: [] }), /enter the invoiced price/);
    assert.throws(
      () => checkInvoiceLines({ receiptLines, lines: [{ realizationLineId: "a", unitPrice: "0", note: "" }] }),
      /greater than 0/,
    );
    assert.throws(
      () =>
        checkInvoiceLines({
          receiptLines,
          lines: [
            { realizationLineId: "a", unitPrice: "1", note: "" },
            { realizationLineId: "a", unitPrice: "1", note: "" },
          ],
        }),
      /twice/,
    );
    assert.throws(
      () =>
        checkInvoiceLines({
          receiptLines,
          lines: [
            { realizationLineId: "a", unitPrice: "1", note: "" },
            { realizationLineId: "b", unitPrice: "1", note: "" },
          ],
        }),
      /not on the chosen receipts/,
    );
  });
});
