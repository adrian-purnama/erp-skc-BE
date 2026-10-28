import Decimal from "decimal.js";
import { formatDecimal } from "../itemMaster/itemUomConvert";
import { remainingToRealize } from "./purchaseRealization.planner";

/** Pure rules for Penerimaan Barang lines (no DB). */

export type ReceiptLineInput = {
  poLineId: string;
  qty: string;
  note: string;
};

export type ReceiptPoLineRef = {
  poLineId: string;
  label: string;
  /** Qty ordered on the PO line. */
  qty: string;
};

/**
 * Validate a receipt against the approved PO. Lines with qty 0 are dropped
 * (nothing of that item arrived this time); at least one must remain.
 */
export function checkReceiptLines(input: {
  lines: ReceiptLineInput[];
  poLines: Map<string, ReceiptPoLineRef>;
  receivedBefore: Map<string, Decimal>;
}): ReceiptLineInput[] {
  const seen = new Set<string>();
  const out: ReceiptLineInput[] = [];
  for (const line of input.lines) {
    const ref = input.poLines.get(line.poLineId);
    if (!ref) throw new Error("A line is not on this PO");
    if (seen.has(line.poLineId)) throw new Error(`${ref.label} is listed twice`);
    seen.add(line.poLineId);
    const qty = new Decimal(line.qty);
    if (qty.isNeg()) throw new Error(`${ref.label}: qty cannot be negative`);
    if (qty.isZero()) continue;
    const left = remainingToRealize(ref.qty, input.receivedBefore.get(line.poLineId));
    if (qty.gt(left)) {
      throw new Error(
        `${ref.label}: only ${formatDecimal(left)} still expected of the ${formatDecimal(new Decimal(ref.qty))} ordered`,
      );
    }
    out.push({ ...line, note: line.note.trim() });
  }
  if (out.length === 0) throw new Error("Enter the qty of at least one item that arrived");
  return out;
}

/** Per SPK material: what is requested, ordered and received so far. */
export type MaterialFlowRow = {
  key: string;
  requested: Decimal;
  ordered: Decimal;
  received: Decimal;
};

/** Add one SPP line's numbers into the per-material roll-up. */
export function addFlow(
  rows: Map<string, MaterialFlowRow>,
  key: string,
  part: { requested?: string; ordered?: Decimal; received?: Decimal },
): void {
  const row = rows.get(key) ?? {
    key,
    requested: new Decimal(0),
    ordered: new Decimal(0),
    received: new Decimal(0),
  };
  if (part.requested) row.requested = row.requested.plus(part.requested);
  if (part.ordered) row.ordered = row.ordered.plus(part.ordered);
  if (part.received) row.received = row.received.plus(part.received);
  rows.set(key, row);
}
