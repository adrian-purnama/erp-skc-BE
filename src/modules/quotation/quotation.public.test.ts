import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Types } from "mongoose";
import { ProjectQuotationRepo } from "../../models/projectQuotation.model";
import { getWonQuotationRef } from "./quotation.public";

function query<T>(value: T) {
  const q = { select: () => q, lean: () => q, exec: async () => value };
  return q;
}

const P = "6ae9bd7a2e3bbc05e91395d0";

describe("getWonQuotationRef", () => {
  afterEach(() => mock.restoreAll());

  it("returns the project's won quotation number and revision", async () => {
    const filters: unknown[] = [];
    mock.method(ProjectQuotationRepo.model, "findOne", (f: unknown) => {
      filters.push(f);
      return query({ _id: new Types.ObjectId(), revision: 2, quotationNumber: "QUO/1" });
    });

    assert.deepEqual(await getWonQuotationRef(P), { revision: 2, quotationNumber: "QUO/1" });
    assert.deepEqual(filters[0], { projectId: new Types.ObjectId(P), status: "won" });
  });

  it("returns null when no quotation was won", async () => {
    mock.method(ProjectQuotationRepo.model, "findOne", () => query(null));
    assert.equal(await getWonQuotationRef(P), null);
  });
});
