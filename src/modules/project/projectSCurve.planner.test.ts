import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPeriods,
  buildSCurve,
  itemActualDates,
  itemActualPctAt,
  itemValues,
  itemWeights,
  plannedPctAt,
  scheduleCalendarEvents,
  scheduleWarnings,
  windowFraction,
  type SCurveActualItem,
  type SCurvePlanItem,
} from "./projectSCurve.planner";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

describe("itemValues / itemWeights", () => {
  it("prices BOQ need at the RAB price and splits labour by role", () => {
    const values = itemValues({
      items: [
        {
          itemId: "A",
          boq: { makeQty: "2", other: { lines: [{ materialItemId: "m1", itemUomId: "u1", qtyPerUnit: "3" }] } },
        },
        { itemId: "B", boq: null },
      ],
      rabLines: [
        { key: "m1:u1", totalQty: "10", unitPrice: "1000", origin: "lock" },
        { key: "A:l1:u", totalQty: "2", unitPrice: "500", origin: "labour", role: "making", shopDrawingItemId: "A" },
        { key: "A:l2:u", totalQty: "2", unitPrice: "1000", origin: "labour", role: "install", shopDrawingItemId: "A" },
        { key: "B:l1:u", totalQty: "1", unitPrice: "2000", origin: "labour", shopDrawingItemId: "B" },
      ],
      uomPlan: new Map(),
    });
    // A: 3×2×1000 materials + 1000 making = 7000; install 2000
    assert.deepEqual(values, [
      { itemId: "A", makingValue: "7000", installValue: "2000" },
      { itemId: "B", makingValue: "2000", installValue: "0" },
    ]);
    const w = itemWeights(values);
    near(w.get("A")!.weightPercent, (9000 / 11000) * 100);
    near(w.get("A")!.installSharePercent, (2000 / 9000) * 100);
    near(w.get("B")!.weightPercent + w.get("A")!.weightPercent, 100);
    assert.equal(w.get("B")!.installSharePercent, 0);
  });

  it("gives every item 0 when nothing is priced", () => {
    const w = itemWeights([{ itemId: "A", makingValue: "0", installValue: "0" }]);
    assert.equal(w.get("A")!.weightPercent, 0);
  });
});

describe("windowFraction / buildPeriods", () => {
  it("is linear over calendar days, inclusive", () => {
    assert.equal(windowFraction("2026-01-01", "2026-01-10", "2025-12-31"), 0);
    assert.equal(windowFraction("2026-01-01", "2026-01-10", "2026-01-05"), 0.5);
    assert.equal(windowFraction("2026-01-01", "2026-01-10", "2026-01-10"), 1);
    assert.equal(windowFraction(null, "2026-01-10", "2026-01-05"), null);
  });

  it("counts 7-day weeks from the start date", () => {
    const p = buildPeriods("2026-01-01", "2026-01-15", "week");
    assert.deepEqual(
      p.map((x) => [x.index, x.start, x.end]),
      [
        [1, "2026-01-01", "2026-01-07"],
        [2, "2026-01-08", "2026-01-14"],
        [3, "2026-01-15", "2026-01-21"],
      ],
    );
    assert.equal(buildPeriods("2026-01-01", "2026-01-03", "day").length, 3);
  });
});

const plan = (over: Partial<SCurvePlanItem> = {}): SCurvePlanItem => ({
  itemId: "A",
  weightPercent: 100,
  installSharePercent: 0,
  makeStart: "2026-01-01",
  makeFinish: "2026-01-14",
  ...over,
});

describe("plannedPctAt", () => {
  it("spreads making and install shares over their windows", () => {
    const items = [
      plan({ weightPercent: 60, installSharePercent: 50, installStart: "2026-01-15", installFinish: "2026-01-28" }),
      plan({ itemId: "B", weightPercent: 40 }),
    ];
    near(plannedPctAt(items, "2026-01-07"), 60 * 0.5 * 0.5 + 40 * 0.5);
    near(plannedPctAt(items, "2026-01-14"), 30 + 40);
    near(plannedPctAt(items, "2026-01-28"), 100);
  });

  it("counts a missing window as 0", () => {
    near(plannedPctAt([plan({ makeStart: null })], "2026-02-01"), 0);
  });
});

const actualItem = (over: Partial<SCurveActualItem> = {}): SCurveActualItem => ({
  itemId: "A",
  weightPercent: 100,
  installSharePercent: 0,
  makeQty: "10",
  lines: [
    { key: "cut", role: "making", sequence: 1, weightPercent: 40 },
    { key: "paint", role: "making", sequence: 2, weightPercent: 60 },
    { key: "inst", role: "install", sequence: null, weightPercent: 100 },
  ],
  reports: [],
  ...over,
});

describe("itemActualPctAt", () => {
  it("replays reports up to the date by stage weight", () => {
    const item = actualItem({
      reports: [
        { date: "2026-01-02", lineKey: "cut", qty: "10" },
        { date: "2026-01-05", lineKey: "paint", qty: "5" },
      ],
    });
    near(itemActualPctAt(item, "2026-01-01"), 0);
    near(itemActualPctAt(item, "2026-01-02"), 40);
    near(itemActualPctAt(item, "2026-01-05"), 40 + 30);
  });

  it("derives actual start and finish dates from reports", () => {
    const item = actualItem({
      reports: [
        { date: "2026-01-02", lineKey: "cut", qty: "10" },
        { date: "2026-01-04", lineKey: "paint", qty: "4" },
        { date: "2026-01-06", lineKey: "paint", qty: "6" },
      ],
    });
    assert.deepEqual(itemActualDates(item, "2026-01-10"), {
      actualStart: "2026-01-02",
      actualFinish: "2026-01-06",
    });
    assert.deepEqual(itemActualDates(item, "2026-01-05"), {
      actualStart: "2026-01-02",
      actualFinish: null,
    });
  });

  it("caps a stage at makeQty and applies the install share", () => {
    const item = actualItem({
      installSharePercent: 20,
      reports: [
        { date: "2026-01-02", lineKey: "cut", qty: "15" },
        { date: "2026-01-02", lineKey: "paint", qty: "10" },
        { date: "2026-01-03", lineKey: "inst", qty: "5" },
      ],
    });
    near(itemActualPctAt(item, "2026-01-03"), 0.8 * 100 + 0.2 * 50);
  });
});

describe("buildSCurve", () => {
  it("builds weekly cumulative points with deltas and today's deviation", () => {
    const out = buildSCurve({
      period: "week",
      today: "2026-01-10",
      plannedStartDate: "2026-01-01",
      plannedFinishDate: "2026-01-14",
      current: [{ ...plan(), label: "A" }],
      baseline: null,
      actual: [actualItem({ reports: [{ date: "2026-01-03", lineKey: "cut", qty: "10" }] })],
    });
    assert.equal(out.points.length, 2);
    assert.equal(out.points[0]!.plannedPct, 50);
    assert.equal(out.points[1]!.plannedPct, 100);
    assert.equal(out.points[1]!.plannedDeltaPct, 50);
    assert.equal(out.points[0]!.actualPct, 40);
    assert.equal(out.points[1]!.actualPct, 40);
    assert.equal(out.points[0]!.baselinePct, null);
    assert.equal(out.today.periodIndex, 2);
    assert.equal(out.today.deviationPct, Math.round((40 - (10 / 14) * 100) * 100) / 100);
    assert.deepEqual(out.items[0]!.plannedByPeriod, [50, 50]);
    assert.deepEqual(out.warnings, []);
  });

  it("leaves actual null for periods after today", () => {
    const out = buildSCurve({
      period: "week",
      today: "2026-01-03",
      plannedStartDate: "2026-01-01",
      plannedFinishDate: "2026-01-14",
      current: [{ ...plan(), label: "A" }],
      baseline: { plannedStartDate: "2026-01-01", plannedFinishDate: "2026-01-07", items: [plan({ makeFinish: "2026-01-07" })] },
      actual: [],
    });
    assert.equal(out.points[1]!.actualPct, null);
    assert.equal(out.points[0]!.baselinePct, 100);
  });
});

describe("scheduleWarnings", () => {
  it("flags missing dates, windows and zero-value items", () => {
    const w = scheduleWarnings({
      plannedStartDate: null,
      plannedFinishDate: null,
      items: [
        { ...plan({ makeStart: null, installSharePercent: 10 }), label: "A" },
        { ...plan({ itemId: "B", weightPercent: 0 }), label: "B" },
      ],
    });
    assert.deepEqual(w, [
      "Set the project planned start and finish dates",
      "A has no making window",
      "A has install labour but no install window",
      "B has no RAB value, so it weighs 0%",
    ]);
  });
});

describe("scheduleCalendarEvents", () => {
  it("emits read-only project deadlines and item ranges", () => {
    const events = scheduleCalendarEvents({
      projectId: "P",
      plannedStartDate: "2026-01-01",
      plannedFinishDate: null,
      items: [{ itemId: "A", label: "A-Sign", makeStart: "2026-01-02", makeFinish: "2026-01-05" }],
    });
    assert.deepEqual(
      events.map((e) => [e.id, e.type, e.title, e.source]),
      [
        ["schedule:start", "deadline", "Project start (plan)", "schedule"],
        ["schedule:A:make", "range", "Making · A-Sign", "schedule"],
      ],
    );
    assert.equal(events[1]!.startAt, "2026-01-02T01:00:00.000Z");
  });
});
