import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { CustomerRepo } from "../../models/customer.model";
import { TermOfPaymentRepo } from "../../models/termOfPayment.model";
import { getCustomerNames, getCustomerRef } from "../customer/customer.public";
import { getTermOfPayment, listActiveTermsOfPayment } from "./termOfPayment.public";

function query<T>(value: T) {
  const q = { select: () => q, sort: () => q, lean: () => q, exec: async () => value };
  return q;
}

const T = "6ae9bd7a2e3bbc05e9139591";
const C = "6ae9bd7a2e3bbc05e9139592";

describe("term of payment public API", () => {
  afterEach(() => mock.restoreAll());

  it("maps a term; unset isActive counts as active", async () => {
    mock.method(TermOfPaymentRepo.model, "findById", () =>
      query({ _id: new Types.ObjectId(T), termOfPayment: "30 days" }),
    );
    assert.deepEqual(await getTermOfPayment(T), { id: T, label: "30 days", isActive: true });
  });

  it("returns null for a missing or invalid id without throwing", async () => {
    const findById = mock.method(TermOfPaymentRepo.model, "findById", () => query(null));
    assert.equal(await getTermOfPayment("nope"), null);
    assert.equal(await getTermOfPayment(null), null);
    assert.equal(findById.mock.callCount(), 0);
    assert.equal(await getTermOfPayment(T), null);
  });

  it("lists active terms only", async () => {
    const filters: unknown[] = [];
    mock.method(TermOfPaymentRepo.model, "find", (f: unknown) => {
      filters.push(f);
      return query([{ _id: new Types.ObjectId(T), termOfPayment: "COD", isActive: true }]);
    });
    assert.deepEqual(await listActiveTermsOfPayment(), [{ id: T, label: "COD", isActive: true }]);
    assert.deepEqual(filters, [{ isActive: { $ne: false } }]);
  });
});

describe("customer public API", () => {
  afterEach(() => mock.restoreAll());

  it("maps a customer and its name", async () => {
    mock.method(CustomerRepo.model, "find", () =>
      query([{ _id: new Types.ObjectId(C), name: "PT Maju", address: "Jl. B", npwp: "01" }]),
    );
    assert.deepEqual(await getCustomerRef(C), {
      id: C,
      name: "PT Maju",
      address: "Jl. B",
      npwp: "01",
      isActive: true,
    });
    assert.equal((await getCustomerNames([C])).get(C), "PT Maju");
  });
});
