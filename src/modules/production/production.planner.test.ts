import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";
import {
  allocatedQty,
  assertFeeWithinHandover,
  assertHandoverChecklist,
  assertLabourStagesForRelease,
  assertOrderQty,
  assertStageReportQty,
  checkDispatchLines,
  assertReportQty,
  evaluateReadiness,
  feeReceivableQty,
  finishedQty,
  maxOrderQty,
  percentOf,
  planFeeLines,
  planMaterials,
  progressStatus,
  qtyByStage,
  weightedProgressPercent,
  type ReadinessItemInput,
} from "./production.planner";

function item(overrides: Partial<ReadinessItemInput> = {}): ReadinessItemInput {
  return {
    itemId: "i1",
    code: "SA1",
    name: "PYLON",
    label: "SA1-PYLON",
    makeType: "inhouse",
    hasShopDrawing: true,
    hasBoq: true,
    makeQty: "2",
    hasProductionFile: true,
    ...overrides,
  };
}

describe("evaluateReadiness", () => {
  const base = {
    wonQuotation: { revision: 2, quotationNumber: "QUO/1/R2" },
    rabStatus: "locked" as const,
    rabChangeOpen: false,
  };

  it("is ready when quotation won, RAB locked and every item complete", () => {
    const r = evaluateReadiness({ ...base, items: [item(), item({ itemId: "i2" })] });
    assert.equal(r.ready, true);
    assert.equal(r.readyCount, 2);
    assert.ok(r.checks.every((c) => c.ok));
  });

  it("flags each missing piece per item", () => {
    const r = evaluateReadiness({
      ...base,
      items: [
        item(),
        item({ itemId: "i2", hasProductionFile: false }),
        item({ itemId: "i3", hasShopDrawing: false, hasBoq: false, makeQty: null }),
      ],
    });
    assert.equal(r.ready, false);
    assert.equal(r.readyCount, 1);
    assert.equal(r.items[1]!.productionFile, false);
    assert.equal(r.items[2]!.shopDrawing, false);
    assert.equal(r.items[2]!.boq, false);
    assert.equal(r.checks.find((c) => c.key === "items")!.ok, false);
  });

  it("does not need File Produksi on an outsource item", () => {
    const r = evaluateReadiness({
      ...base,
      items: [
        item({ makeType: "outsource", hasProductionFile: false }),
        item({ itemId: "i2", makeType: "outsource", hasProductionFile: false, hasBoq: false, makeQty: null }),
      ],
    });
    assert.equal(r.items[0]!.ready, true);
    assert.equal(r.items[0]!.productionFileRequired, false);
    // Still needs the BOQ qty.
    assert.equal(r.items[1]!.ready, false);
  });

  it("treats a zero make qty as no BOQ", () => {
    const r = evaluateReadiness({ ...base, items: [item({ makeQty: "0" })] });
    assert.equal(r.items[0]!.boq, false);
    assert.equal(r.ready, false);
  });

  it("needs a won quotation and a locked RAB with no open change", () => {
    assert.equal(
      evaluateReadiness({ ...base, wonQuotation: null, items: [item()] }).ready,
      false,
    );
    assert.equal(
      evaluateReadiness({ ...base, rabChangeOpen: true, items: [item()] }).ready,
      false,
    );
    assert.equal(
      evaluateReadiness({ ...base, rabStatus: "draft", items: [item()] }).ready,
      false,
    );
  });

  it("is not ready with no items", () => {
    assert.equal(evaluateReadiness({ ...base, items: [] }).ready, false);
  });
});

describe("qty cap", () => {
  const orders = [
    { id: "a", status: "released" as const, qty: "4" },
    { id: "b", status: "cancelled" as const, qty: "3" },
    { id: "c", status: "completed" as const, qty: "3" },
    { id: "d", status: "draft" as const, qty: "1" },
  ];
  const done = new Map([["c", "2"]]);

  it("counts open qty, completed done qty, and ignores cancelled", () => {
    assert.equal(allocatedQty(orders, done).toString(), "7");
  });

  it("frees qty from the edited order", () => {
    assert.equal(maxOrderQty("10", orders, done, "a").toString(), "7");
    assert.equal(maxOrderQty("10", orders, done).toString(), "3");
  });

  it("never goes below zero", () => {
    assert.equal(maxOrderQty("5", orders, done).toString(), "0");
  });

  it("rejects qty over the free amount", () => {
    assert.throws(() => assertOrderQty("4", maxOrderQty("10", orders, done)), /still free/);
    assert.doesNotThrow(() => assertOrderQty("3", maxOrderQty("10", orders, done)));
  });
});

describe("assertReportQty", () => {
  it("allows up to what is left on the SPK", () => {
    assert.doesNotThrow(() => assertReportQty("2", "5", "3"));
    assert.throws(() => assertReportQty("3", "5", "3"), /left on this SPK/);
    assert.throws(() => assertReportQty("0", "5", "0"), /greater than 0/);
  });
});

describe("planMaterials", () => {
  it("sums per material×UOM and scales by SPK qty", () => {
    const rows = planMaterials(
      {
        makeQty: "10",
        main: {
          parts: [
            {
              bases: [
                {
                  materialItemId: "ply",
                  itemUomId: "sheet",
                  qtyPerUnit: "0.5",
                  finishings: [
                    { lines: [{ materialItemId: "paint", itemUomId: "l", qtyPerUnit: "0.2" }] },
                  ],
                },
              ],
            },
          ],
          assembly: { lines: [{ materialItemId: "ply", itemUomId: "sheet", qtyPerUnit: "0.25" }] },
        },
      },
      "4",
    );
    const ply = rows.find((r) => r.materialItemId === "ply")!;
    assert.equal(ply.qtyPerUnit, "0.75");
    assert.equal(ply.qty, "3");
    assert.equal(rows.find((r) => r.materialItemId === "paint")!.qty, "0.8");
  });

  const aluBoq = {
    makeQty: "1000",
    main: {
      parts: [
        {
          bases: [
            { materialItemId: "alu", itemUomId: "sht", qtyPerUnit: "0.02040816", finishings: [] },
          ],
        },
      ],
    },
  };
  const wholeSheets = new Map([
    ["alu:sht", { targetItemUomId: "sht", factor: "1", rounding: { step: "1", source: "item" as const, mode: "up" as const } }],
  ]);

  it("rounds the running total so split SPKs add up to the rounded whole", () => {
    const first = planMaterials(aluBoq, "500", { plan: wholeSheets }).find(
      (r) => r.materialItemId === "alu",
    )!;
    assert.equal(first.exactQty, "10.20408");
    assert.equal(first.qty, "11");

    const second = planMaterials(aluBoq, "500", {
      plan: wholeSheets,
      prior: new Map([["alu:sht", { exactQty: first.exactQty, qty: first.qty }]]),
    }).find((r) => r.materialItemId === "alu")!;
    assert.equal(second.qty, "10");
  });

  it("converts the RAB step into the SPK unit", () => {
    // RAB rounds in m² to whole sheets (1 sht = 2.9768 m²); the SPK stays in sheets.
    const plan = new Map([
      ["alu:sht", { targetItemUomId: "m2", factor: "2.9768", rounding: { step: "2.9768", source: "item" as const, mode: "up" as const } }],
    ]);
    const row = planMaterials(aluBoq, "500", { plan }).find((r) => r.materialItemId === "alu")!;
    assert.equal(row.itemUomId, "sht");
    assert.equal(row.qty, "11");
  });

  it("never goes below zero when earlier SPKs already covered it", () => {
    const row = planMaterials(aluBoq, "10", {
      plan: wholeSheets,
      prior: new Map([["alu:sht", { exactQty: "10.2", qty: "11" }]]),
    }).find((r) => r.materialItemId === "alu")!;
    assert.equal(row.exactQty, "0.2040816");
    assert.equal(row.qty, "0");
  });
});

describe("progress", () => {
  it("maps qty to a status", () => {
    assert.equal(progressStatus({ makeQty: "5", orderedQty: "0", doneQty: "0" }), "not_started");
    assert.equal(progressStatus({ makeQty: "5", orderedQty: "3", doneQty: "0" }), "partial");
    assert.equal(progressStatus({ makeQty: "5", orderedQty: "5", doneQty: "2" }), "in_progress");
    assert.equal(progressStatus({ makeQty: "5", orderedQty: "5", doneQty: "5" }), "done");
  });

  it("rounds and clamps percent", () => {
    assert.equal(percentOf("1", "3"), 33);
    assert.equal(percentOf("4", "0"), 0);
    assert.equal(percentOf("6", "5"), 100);
  });
});

describe("labour stages", () => {
  const stages = [
    { sequence: 1, weightPercent: 40 },
    { sequence: 2, weightPercent: 40 },
    { sequence: 3, weightPercent: 20 },
  ];

  it("accepts stages that sum to 100 with sequences 1..n", () => {
    assertLabourStagesForRelease(stages);
  });

  it("refuses weights that do not total 100", () => {
    assert.throws(
      () =>
        assertLabourStagesForRelease([
          { sequence: 1, weightPercent: 50 },
          { sequence: 2, weightPercent: 40 },
        ]),
      /total 100%/,
    );
  });

  it("refuses gaps in sequence", () => {
    assert.throws(
      () =>
        assertLabourStagesForRelease([
          { sequence: 1, weightPercent: 50 },
          { sequence: 3, weightPercent: 50 },
        ]),
      /1, 2, 3/,
    );
  });

  it("sums qty per stage and finished qty is the last stage", () => {
    const by = qtyByStage(
      [
        { qtyDone: "10", stageSequence: 1 },
        { qtyDone: "5", stageSequence: 1 },
        { qtyDone: "8", stageSequence: 2 },
        { qtyDone: "3", stageSequence: 3 },
      ],
      stages,
    );
    assert.equal(by.get(1), "15");
    assert.equal(by.get(2), "8");
    assert.equal(by.get(3), "3");
    assert.equal(finishedQty(stages, by), "3");
  });

  it("weights progress across stages", () => {
    // 100 pcs: all cut (40), half painted (20), none UV → 60%
    const by = new Map([
      [1, "100"],
      [2, "50"],
      [3, "0"],
    ]);
    assert.equal(weightedProgressPercent("100", stages, by), 60);
  });

  it("caps a stage report by the previous stage", () => {
    const by = new Map([
      [1, "10"],
      [2, "8"],
      [3, "0"],
    ]);
    assert.throws(
      () =>
        assertStageReportQty({
          stages,
          qtyByStage: by,
          stageSequence: 2,
          qtyDone: "3",
          orderQty: "100",
        }),
      /left on this stage/,
    );
    assertStageReportQty({
      stages,
      qtyByStage: by,
      stageSequence: 2,
      qtyDone: "2",
      orderQty: "100",
    });
  });

  it("caps the first stage by the SPK qty", () => {
    assert.throws(
      () =>
        assertStageReportQty({
          stages,
          qtyByStage: new Map([
            [1, "95"],
            [2, "0"],
            [3, "0"],
          ]),
          stageSequence: 1,
          qtyDone: "6",
          orderQty: "100",
        }),
      /left on this stage/,
    );
  });
});

describe("planFeeLines", () => {
  const fee = [{ materialItemId: "jasa", itemUomId: "lot", totalQty: "1" }];

  it("gives a full-qty SPK exactly the RAB fee qty", () => {
    const [line] = planFeeLines(fee, "3", "3");
    assert.equal(line!.qty, "1");
  });

  it("spreads the fee over a partial SPK", () => {
    const [line] = planFeeLines(
      [{ materialItemId: "jasa", itemUomId: "unit", totalQty: "10" }],
      "10",
      "4",
    );
    assert.equal(line!.qty, "4");
    assert.equal(line!.qtyPerUnit, "1");
  });

  it("returns nothing without a make qty", () => {
    assert.deepEqual(planFeeLines(fee, "0", "1"), []);
  });
});

describe("assertHandoverChecklist", () => {
  it("accepts every row checked, with notes on not OK rows", () => {
    assertHandoverChecklist([
      { label: "Dimensions", result: "ok", note: "" },
      { label: "Finishing", result: "not_ok", note: "Scratch on one panel, vendor fixes on site" },
    ]);
  });

  it("refuses an empty checklist", () => {
    assert.throws(() => assertHandoverChecklist([]), /at least one checklist row/);
  });

  it("refuses unchecked rows", () => {
    assert.throws(
      () => assertHandoverChecklist([{ label: "Dimensions", result: null, note: "" }]),
      /still open: Dimensions/,
    );
  });

  it("refuses not OK without a note", () => {
    assert.throws(
      () => assertHandoverChecklist([{ label: "Finishing", result: "not_ok", note: " " }]),
      /note to each row marked not OK \(Finishing\)/,
    );
  });
});

describe("feeReceivableQty", () => {
  it("is the fee share of the units handed over", () => {
    assert.equal(feeReceivableQty("1", "10", "4").toString(), "0.4");
    assert.equal(feeReceivableQty("2500000", "10", "10").toString(), "2500000");
  });

  it("caps at the SPK qty and handles an empty SPK", () => {
    assert.equal(feeReceivableQty("1", "10", "12").toString(), "1");
    assert.equal(feeReceivableQty("1", "0", "3").toString(), "0");
  });
});

describe("assertFeeWithinHandover", () => {
  const base = { label: "Jasa pasang", feeQty: "1", spkQty: "10", doneQty: "4" };

  it("allows up to the handed-over share", () => {
    assertFeeWithinHandover({ ...base, realizedQty: "0.4" });
  });

  it("refuses more than the handed-over share", () => {
    assert.throws(
      () => assertFeeWithinHandover({ ...base, realizedQty: "0.5" }),
      /only 0.4 of 1 can be received so far \(4 of 10 units handed over\)/,
    );
  });

  it("refuses any fee before a handover", () => {
    assert.throws(() => assertFeeWithinHandover({ ...base, doneQty: "0", realizedQty: "1" }), /only 0 of 1/);
  });
});

describe("checkDispatchLines", () => {
  const allowed = new Map([
    ["m1:u1", { label: "Akrilik 3mm", available: new Decimal(10) }],
    ["m2:u2", { label: "Lem", available: new Decimal(0) }],
  ]);
  const line = (materialItemId: string, itemUomId: string, qty: string) => ({ materialItemId, itemUomId, qty });

  it("keeps lines within what is at the warehouse, dropping zero lines", () => {
    assert.deepEqual(checkDispatchLines([line("m1", "u1", "4.50"), line("m2", "u2", "0")], allowed), [
      line("m1", "u1", "4.5"),
    ]);
  });

  it("refuses more than is available", () => {
    assert.throws(
      () => checkDispatchLines([line("m1", "u1", "11")], allowed),
      /Akrilik 3mm: only 10 is at our warehouse/,
    );
  });

  it("refuses foreign, duplicate and empty lines", () => {
    assert.throws(() => checkDispatchLines([line("x", "y", "1")], allowed), /not material of this SPK/);
    assert.throws(
      () => checkDispatchLines([line("m1", "u1", "1"), line("m1", "u1", "2")], allowed),
      /listed twice/,
    );
    assert.throws(() => checkDispatchLines([line("m1", "u1", "0")], allowed), /at least one material/);
  });
});
