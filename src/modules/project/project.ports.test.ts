import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { ProjectQuotationRepo } from "../../models/projectQuotation.model";
import { quotationForProject } from "../quotation/quotation.forProject";
import { productionPort, provideProjectPorts, quotationPort } from "./project.ports";

describe("project ports", () => {
  it("fail loudly when used before wiring, and return what was provided", () => {
    assert.throws(() => productionPort(), /project ports are not wired/);
    const fake = {
      production: {} as never,
      quotation: { hasWonQuotation: async () => true, contractQuotations: async () => [] },
      purchasing: {} as never,
    };
    provideProjectPorts(fake);
    assert.equal(quotationPort(), fake.quotation);
  });
});

describe("quotationForProject.contractQuotations", () => {
  it("prices won / issued quotations with quotation's own rules", async (t) => {
    const P = new Types.ObjectId("6ae9bd7a2e3bbc05e91397a1");
    t.mock.method(ProjectQuotationRepo.model, "find", () => {
      const q = {
        select: () => q,
        lean: () => q,
        exec: async () => [
          {
            projectId: P,
            status: "won",
            revision: 2,
            discountType: "amount",
            discountValue: "0",
            taxPercent: "11",
            lines: [{ qty: "2", unitPrice: "1000", costUnitPrice: "0" }],
          },
        ],
      };
      return q;
    });
    assert.deepEqual(await quotationForProject.contractQuotations([String(P)]), [
      { projectId: String(P), status: "won", revision: 2, taxBase: "2000", grandTotal: "2220" },
    ]);
  });
});
