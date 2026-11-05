import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";
import {
  allocatedQty,
  assertFeeWithinHandover,
  assertHandoverChecklist,
  assertLabourStages,
  assertProcessChange,
  assertOrderQty,
  assertStageReport,
  assertStageVoid,
  checkDispatchLines,
  assertReportQty,
  evaluateReadiness,
  feeReceivableQty,
  installCapacity,
  installedQty,
  itemInstallPercent,
  itemMakingPercent,
  madeQty,
  maxOrderQty,
  percentOf,
  planFeeLines,
  planMaterials,
  progressStatus,
  stageRoom,
  type ProcessLine,
  type ReadinessItemInput,
  type StageLine,
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
    labour: [{ key: "cut", role: "making", sequence: 1, weightPercent: 100 }],
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

  it("does not need the process to release (only reports it)", () => {
    const r = evaluateReadiness({
      ...base,
      items: [
        item({ labour: [] }),
        item({
          itemId: "i2",
          labour: [{ key: "cut", role: "making", sequence: 1, weightPercent: 60 }],
        }),
      ],
    });
    assert.equal(r.ready, true);
    assert.equal(r.items[0]!.labour, false);
    assert.match(r.items[1]!.labourDetail, /total 100%/);
  });

  it("needs no BOQ on an outsource item, only its qty", () => {
    const r = evaluateReadiness({
      ...base,
      items: [
        item({ makeType: "outsource", hasBoq: false, makeQty: "5", hasProductionFile: false }),
        item({ itemId: "i2", makeType: "inhouse", hasBoq: false, makeQty: "5" }),
      ],
    });
    assert.equal(r.items[0]!.boqRequired, false);
    assert.equal(r.items[0]!.ready, true);
    // Inhouse still needs its BOQ.
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
  // Acrylic: cutting 40% → cat 40% → UV 20%, then deliver 30% → pasang 70%.
  const lines: StageLine[] = [
    { key: "uv", role: "making", sequence: 3, weightPercent: 20 },
    { key: "cut", role: "making", sequence: 1, weightPercent: 40 },
    { key: "cat", role: "making", sequence: 2, weightPercent: 40 },
    { key: "pasang", role: "install", sequence: 2, weightPercent: 70 },
    { key: "kirim", role: "install", sequence: 1, weightPercent: 30 },
  ];
  const done = new Map([
    ["cut", "10"],
    ["cat", "6"],
    ["uv", "4"],
    ["kirim", "3"],
    ["pasang", "1"],
  ]);

  it("SPKs need making stages 1..n totalling 100, and install the same if any", () => {
    assertLabourStages(lines);
    assertLabourStages(lines.filter((l) => l.role === "making"));
    assert.throws(() => assertLabourStages([lines[3]!]), /at least one making stage/);
    assert.throws(
      () => assertLabourStages([{ ...lines[1]!, weightPercent: 50 }, lines[2]!, lines[0]!]),
      /Making labour weights must total 100% \(currently 110%\)/,
    );
    assert.throws(
      () => assertLabourStages([lines[1]!, lines[2]!, lines[0]!, { ...lines[4]!, weightPercent: 40 }, lines[3]!]),
      /Install labour weights must total 100%/,
    );
    assert.throws(
      () => assertLabourStages([lines[1]!, lines[2]!, lines[0]!, lines[3]!]),
      /Install labour sequences/,
    );
  });

  it("made pcs are the last making stage, installed the last install step", () => {
    assert.equal(madeQty(lines, done), "4");
    assert.equal(madeQty([], done), "0");
    assert.equal(installedQty(lines, done), "1");
  });

  it("a stage may report what the previous stage passed on", () => {
    assert.equal(stageRoom(lines, done, "cut"), null);
    assert.equal(stageRoom(lines, done, "cat")!.toString(), "4");
    assert.equal(stageRoom(lines, done, "uv")!.toString(), "2");
    // Install step 1: fully made pcs not yet delivered; step 2: delivered not yet installed.
    assert.equal(stageRoom(lines, done, "kirim")!.toString(), "1");
    assert.equal(stageRoom(lines, done, "pasang")!.toString(), "2");
    assert.equal(installCapacity(lines, done, "kirim"), "4");
    assert.equal(installCapacity(lines, done, "pasang"), "3");
  });

  it("refuses a report past the SPK qty or the stage room", () => {
    assertStageReport({ qtyDone: "4", orderQty: "10", orderDone: "0", room: new Decimal(4), fromLabel: "Cutting" });
    assert.throws(
      () => assertStageReport({ qtyDone: "5", orderQty: "10", orderDone: "0", room: new Decimal(4), fromLabel: "Cutting" }),
      /4 Cutting has passed on/,
    );
    assert.throws(
      () => assertStageReport({ qtyDone: "3", orderQty: "10", orderDone: "8", room: null, fromLabel: "" }),
      /left on this SPK/,
    );
  });

  it("refuses a void that leaves a later stage ahead", () => {
    assertStageVoid(lines, done, "cat", "2");
    assert.throws(() => assertStageVoid(lines, done, "cat", "3"), /next stage/);
    // Last making stage vs install step 1.
    assertStageVoid(lines, done, "uv", "1");
    assert.throws(() => assertStageVoid(lines, done, "uv", "2"), /installed/);
    // Install step 1 vs step 2.
    assertStageVoid(lines, done, "kirim", "2");
    assert.throws(() => assertStageVoid(lines, done, "kirim", "3"), /next stage/);
    assertStageVoid(lines, done, "pasang", "1");
  });

  it("weights each track", () => {
    // (10×40 + 6×40 + 4×20) / 10 = 72
    assert.equal(itemMakingPercent("10", lines, done), 72);
    assert.equal(itemMakingPercent("0", lines, done), 0);
    // (3×30 + 1×70) / 10 = 16
    assert.equal(itemInstallPercent("10", lines, done), 16);
  });
});

describe("assertProcessChange", () => {
  const p = (key: string, role: StageLine["role"], sequence: number, weightPercent: number): ProcessLine => ({
    key,
    role,
    sequence,
    weightPercent,
    name: key,
    executor: "inhouse",
  });
  const before = [p("cut", "making", 1, 40), p("cat", "making", 2, 40), p("uv", "making", 3, 20)];
  const done = new Map([
    ["cut", "10"],
    ["cat", "6"],
  ]);
  const live = new Set(["cut", "cat"]);

  it("allows reweighting and adding a stage where nothing downstream has started", () => {
    assertProcessChange({
      before,
      after: [p("cut", "making", 1, 30), p("cat", "making", 2, 30), p("coat", "making", 3, 20), p("uv", "making", 4, 20)],
      liveKeys: live,
      doneByLine: done,
    });
  });

  it("refuses an order where a stage did more than what feeds it", () => {
    assert.throws(
      () =>
        assertProcessChange({
          before,
          after: [p("cut", "making", 1, 30), p("coat", "making", 2, 30), p("cat", "making", 3, 20), p("uv", "making", 4, 20)],
          liveKeys: live,
          doneByLine: done,
        }),
      /cat already did 6, more than the 0 coat/,
    );
  });

  it("keeps lines with live SPKs: not removed, same role and executor, stage 1 stays first", () => {
    assert.throws(
      () => assertProcessChange({ before, after: [p("cut", "making", 1, 100)], liveKeys: live, doneByLine: done }),
      /cat has live SPKs: cancel them/,
    );
    assert.throws(
      () =>
        assertProcessChange({
          before,
          after: [p("cut", "making", 1, 60), { ...p("cat", "making", 2, 40), executor: "vendor" }, p("uv", "making", 3, 20)],
          liveKeys: live,
          doneByLine: done,
        }),
      /inhouse \/ vendor/,
    );
    assert.throws(
      () =>
        assertProcessChange({
          before,
          after: [p("cat", "making", 1, 40), p("cut", "making", 2, 40), p("uv", "making", 3, 20)],
          liveKeys: new Set(["cut"]),
          doneByLine: new Map(),
        }),
      /must stay making stage 1/,
    );
    // A stage with no live SPKs can be removed.
    assertProcessChange({
      before,
      after: [p("cut", "making", 1, 50), p("cat", "making", 2, 50)],
      liveKeys: live,
      doneByLine: done,
    });
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
