import Decimal from "decimal.js";
import {
  formatDecimal,
  parseQtyDecimal,
} from "../itemMaster/itemUomConvert";
import { computeTotals, type QuotationDiscountType } from "../quotation/quotation.planner";
import { percentOf } from "../production/production.planner";
import { computeLineTotal, sumGrandTotal } from "./projectRab.planner";
import type { ProjectSummaryOutDto } from "../../dto/project.dto";

export type SummaryQuotation = {
  status: string;
  revision: number;
  discountType: QuotationDiscountType;
  discountValue: string;
  taxPercent: string;
  lines: Array<{ qty: string; unitPrice: string; costUnitPrice: string }>;
};

export type SummaryRab = {
  status: "draft" | "locked";
  lines: Array<{ totalQty: string; unitPrice?: string | null }>;
};

export type SummaryDeadline = { at: Date; title: string };

export type SummaryInput = {
  quotations: SummaryQuotation[];
  rab: SummaryRab | null;
  realizationTotals: string[];
  shopDrawingCount: number;
  orders: Array<{ qty: string; plannedFinish?: string | null }>;
  reportQtys: string[];
  deadlines: SummaryDeadline[];
  now: Date;
};

function sum(values: string[]): Decimal {
  return values.reduce(
    (acc, v) => acc.add(parseQtyDecimal(v || "0")),
    new Decimal(0),
  );
}

/**
 * Splits a posted realization's total across projects by line value, so
 * charges (tax, shipping) follow the lines they were paid with.
 */
export function allocateRealizationCost(input: {
  lines: Array<{ projectId: string | null; qty: string; unitPrice: string }>;
  subtotal: string;
  total: string;
}): Array<{ projectId: string; amount: string }> {
  const subtotal = parseQtyDecimal(input.subtotal || "0");
  const total = parseQtyDecimal(input.total || "0");
  const byProject = new Map<string, Decimal>();
  for (const line of input.lines) {
    if (!line.projectId) continue;
    const value = parseQtyDecimal(line.qty).mul(parseQtyDecimal(line.unitPrice));
    byProject.set(
      line.projectId,
      (byProject.get(line.projectId) ?? new Decimal(0)).add(value),
    );
  }
  return [...byProject.entries()].map(([projectId, value]) => ({
    projectId,
    amount: formatDecimal(
      subtotal.gt(0) ? value.mul(total).div(subtotal).round() : value.round(),
    ),
  }));
}

/** Won quotation wins; otherwise the highest-revision issued one. */
export function pickContractQuotation(
  quotations: SummaryQuotation[],
): SummaryQuotation | null {
  const won = quotations.find((q) => q.status === "won");
  if (won) return won;
  const issued = quotations
    .filter((q) => q.status === "issued")
    .sort((a, b) => b.revision - a.revision);
  return issued[0] ?? null;
}

/** Next upcoming deadline, else the most recent past one. */
export function pickDeadline(
  deadlines: SummaryDeadline[],
  now: Date,
): SummaryDeadline | null {
  const sorted = [...deadlines].sort((a, b) => a.at.getTime() - b.at.getTime());
  const upcoming = sorted.find((d) => d.at.getTime() >= now.getTime());
  return upcoming ?? sorted[sorted.length - 1] ?? null;
}

export function buildProjectSummary(input: SummaryInput): ProjectSummaryOutDto {
  const quotation = pickContractQuotation(input.quotations);
  const totals = quotation
    ? computeTotals({
        lines: quotation.lines,
        discountType: quotation.discountType,
        discountValue: quotation.discountValue,
        taxPercent: quotation.taxPercent,
      })
    : null;

  const rabTotal = input.rab
    ? sumGrandTotal(
        input.rab.lines.map((l) => computeLineTotal(l.totalQty, l.unitPrice)),
      )
    : null;

  const plannedMargin =
    totals && rabTotal !== null
      ? formatDecimal(parseQtyDecimal(totals.taxBase).sub(parseQtyDecimal(rabTotal)))
      : null;

  const ordered = formatDecimal(sum(input.orders.map((o) => o.qty)));
  const done = formatDecimal(sum(input.reportQtys));

  const calendarDeadline = pickDeadline(input.deadlines, input.now);
  const plannedFinish = input.orders
    .map((o) => o.plannedFinish ?? "")
    .filter((d) => d !== "")
    .sort()
    .pop();

  return {
    contractValue: totals ? totals.grandTotal : null,
    contractStatus: quotation
      ? quotation.status === "won"
        ? "won"
        : "issued"
      : null,
    plannedMargin,
    rabTotal,
    rabStatus: input.rab ? input.rab.status : null,
    actualCost: formatDecimal(sum(input.realizationTotals)),
    shopDrawingCount: input.shopDrawingCount,
    productionOrderedQty: ordered,
    productionDoneQty: done,
    productionPercent: percentOf(done, ordered),
    deadline: calendarDeadline
      ? calendarDeadline.at.toISOString()
      : plannedFinish
        ? new Date(`${plannedFinish}T00:00:00+07:00`).toISOString()
        : null,
    deadlineTitle: calendarDeadline
      ? calendarDeadline.title
      : plannedFinish
        ? "SPK planned finish"
        : null,
  };
}
