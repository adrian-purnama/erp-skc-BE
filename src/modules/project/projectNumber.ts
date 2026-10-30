import type { ClientSession } from "mongoose";
import { ProjectSeqCounterModel } from "../../models/seqCounter.model";
import { jakartaYmdParts } from "../../utils/shared";

const ROMAN_MONTHS = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
] as const;

export type JakartaYmd = {
  year: number;
  month: number;
};

export type ProjectNumberParts = JakartaYmd & {
  roman: string;
  scopeKey: string;
};

export type SeqAllocator = {
  next(scopeKey: string, session?: ClientSession): Promise<number>;
};

export function jakartaYmd(now: Date = new Date()): JakartaYmd {
  const { year, month } = jakartaYmdParts(now);
  return { year, month };
}

export function toRomanMonth(month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("month must be an integer from 1 to 12");
  }
  return ROMAN_MONTHS[month - 1];
}

export function projectNumberParts(now: Date = new Date()): ProjectNumberParts {
  const { year, month } = jakartaYmd(now);
  return {
    year,
    month,
    roman: toRomanMonth(month),
    scopeKey: `${year}-${String(month).padStart(2, "0")}`,
  };
}

export function formatProjectNumber(
  roman: string,
  year: number,
  seq: number,
): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error("sequence must be a positive integer");
  }
  return `PRJ/${roman}/${year}/${String(seq).padStart(4, "0")}`;
}

export const mongoSeqAllocator: SeqAllocator = {
  async next(scopeKey, session) {
    const updated = await ProjectSeqCounterModel.findOneAndUpdate(
      { scopeKey },
      { $inc: { nextSeq: 1 }, $setOnInsert: { scopeKey } },
      { upsert: true, new: true, session },
    ).exec();
    if (!updated || updated.nextSeq < 1) {
      throw new Error("Failed to allocate project sequence");
    }
    return updated.nextSeq;
  },
};

export async function allocateProjectNumber(opts?: {
  now?: Date;
  session?: ClientSession;
  allocator?: SeqAllocator;
}): Promise<string> {
  const now = opts?.now ?? new Date();
  const allocator = opts?.allocator ?? mongoSeqAllocator;
  const parts = projectNumberParts(now);
  const seq = await allocator.next(parts.scopeKey, opts?.session);
  return formatProjectNumber(parts.roman, parts.year, seq);
}
