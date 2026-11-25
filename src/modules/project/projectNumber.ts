import type { ClientSession } from "mongoose";
import { ProjectSeqCounterModel } from "../../models/seqCounter.model";
import { numberingPeriod } from "../../utils/numbering";

export type SeqAllocator = {
  next(scopeKey: string, session?: ClientSession): Promise<number>;
};

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
      { upsert: true, returnDocument: "after", session },
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
  const parts = numberingPeriod(now);
  const seq = await allocator.next(parts.scopeKey, opts?.session);
  return formatProjectNumber(parts.roman, parts.year, seq);
}
