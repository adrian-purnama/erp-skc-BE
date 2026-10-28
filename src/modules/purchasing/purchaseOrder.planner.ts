import Decimal from "decimal.js";

/** Pure rules for PO lines (no DB). */

export type OrderLineInput = {
  requestLineId: string;
  qty: string;
  /** Integer rupiah per unit. */
  unitPrice: string;
  note: string;
};

/** The SPP line a PO line orders. */
export type RequestLineRef = {
  requestId: string;
  requestLineId: string;
  requestNumber: string;
  /** SPP status; only submitted SPPs can be ordered. */
  requestStatus: string;
  label: string;
  qty: string;
};

export type CheckedOrderLine = OrderLineInput & {
  /** qty × unitPrice, integer rupiah. */
  amount: string;
  /** Ordered more than the SPP line still needed (e.g. rounded up). */
  overRequest: boolean;
};

export type RequestLineOrderStatus = "open" | "partial" | "ordered";

/** Σ qty per SPP line over the given PO lines. */
export function sumOrdered(
  lines: Array<{ requestLineId: string; qty: string }>,
): Map<string, Decimal> {
  const sums = new Map<string, Decimal>();
  for (const l of lines) {
    sums.set(l.requestLineId, (sums.get(l.requestLineId) ?? new Decimal(0)).plus(l.qty));
  }
  return sums;
}

/** Requested − ordered, never below 0. */
export function remainingToOrder(requested: string, ordered: Decimal | undefined): Decimal {
  const left = new Decimal(requested).minus(ordered ?? 0);
  return left.isNeg() ? new Decimal(0) : left;
}

export function requestLineOrderStatus(
  requested: string,
  ordered: Decimal | undefined,
): RequestLineOrderStatus {
  const o = ordered ?? new Decimal(0);
  if (o.lte(0)) return "open";
  return o.gte(requested) ? "ordered" : "partial";
}

/** SPP-level status from its lines: ordered only when every line is. */
export function requestOrderStatus(
  statuses: RequestLineOrderStatus[],
): RequestLineOrderStatus {
  if (statuses.length === 0 || statuses.every((s) => s === "open")) return "open";
  return statuses.every((s) => s === "ordered") ? "ordered" : "partial";
}

export function lineAmount(qty: string, unitPrice: string): Decimal {
  return new Decimal(qty).times(unitPrice).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

/**
 * Validate PO lines against their SPP lines. `orderedElsewhere` is what other
 * live POs already ordered per SPP line.
 */
export function checkOrderLines(input: {
  /** Every line must come from this SPP. */
  requestId: string;
  lines: OrderLineInput[];
  requestLines: Map<string, RequestLineRef>;
  orderedElsewhere: Map<string, Decimal>;
}): { lines: CheckedOrderLine[]; total: string } {
  if (input.lines.length === 0) throw new Error("Add at least one item");
  const seen = new Set<string>();
  let total = new Decimal(0);
  const lines = input.lines.map((line) => {
    const ref = input.requestLines.get(line.requestLineId);
    if (!ref) throw new Error("A line refers to a request line that no longer exists");
    if (ref.requestId !== input.requestId) {
      throw new Error(`${ref.label} is from ${ref.requestNumber}: a PO takes items from one SPP only`);
    }
    const name = `${ref.label} (${ref.requestNumber})`;
    if (seen.has(line.requestLineId)) throw new Error(`${name} is listed twice`);
    seen.add(line.requestLineId);
    if (ref.requestStatus !== "submitted") {
      throw new Error(`${ref.requestNumber} is no longer open for ordering`);
    }
    const left = remainingToOrder(ref.qty, input.orderedElsewhere.get(line.requestLineId));
    if (left.lte(0)) throw new Error(`${name} is already fully ordered`);
    const qty = new Decimal(line.qty);
    if (qty.lte(0)) throw new Error(`${name}: qty must be greater than 0`);
    const price = new Decimal(line.unitPrice);
    if (price.lte(0)) throw new Error(`${name}: enter a unit price`);
    const amount = lineAmount(line.qty, line.unitPrice);
    total = total.plus(amount);
    return {
      ...line,
      note: line.note.trim(),
      amount: amount.toFixed(0),
      overRequest: qty.gt(left),
    };
  });
  return { lines, total: total.toFixed(0) };
}

