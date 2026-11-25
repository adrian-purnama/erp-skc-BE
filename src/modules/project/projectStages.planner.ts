import Decimal from "decimal.js";

/**
 * How RAB labour lines weight progress: a line's stage order and weight
 * come from the RAB, so the S-curve and SPK progress share these rules.
 */

/** One RAB labour line of an item, as the SPK stage rules see it. */
export type StageLine = {
  key: string;
  role: "making" | "install";
  sequence: number | null;
  weightPercent: number | null;
};

export type StageRole = StageLine["role"];

/** One track's lines (making or install) in stage order, unsequenced last. */
export function stagesOf<T extends StageLine>(lines: T[], role: StageRole): T[] {
  return lines
    .filter((l) => l.role === role)
    .sort((a, b) => (a.sequence ?? 9999) - (b.sequence ?? 9999));
}

function doneOf(doneByLine: Map<string, string>, key: string): Decimal {
  return new Decimal(doneByLine.get(key) ?? "0");
}

/** Unrounded track %: Σ weight × min(stage done, makeQty) ÷ makeQty, clamped 0–100. */
export function trackPercentExact(
  makeQty: string,
  lines: StageLine[],
  doneByLine: Map<string, string>,
  role: StageRole,
): number {
  const make = new Decimal(makeQty);
  if (make.lte(0)) return 0;
  let sum = new Decimal(0);
  for (const s of stagesOf(lines, role)) {
    const done = Decimal.min(doneOf(doneByLine, s.key), make);
    sum = sum.plus(done.div(make).times(s.weightPercent ?? 0));
  }
  return Math.min(100, Math.max(0, sum.toNumber()));
}
