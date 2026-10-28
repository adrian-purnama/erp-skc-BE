import { Types } from "mongoose";
import type { ProjectRabLine } from "../../models/projectRab/projectRab.model";
import type { ProjectRabChangeBoqSnapshot } from "../../models/projectRabChange/projectRabChange.model";
import {
  aggregateBoqLinesToRab,
  collectSourceLines,
  computeLineTotal,
  isLabourLine,
  mergeRabPricing,
  sumGrandTotal,
  type BoqLike,
  type RabUomPlan,
} from "./projectRab.planner";
export type LeanBoqDoc = {
  shopDrawingItemId: Types.ObjectId;
  shopDrawingFileId: Types.ObjectId;
  makeQty: string;
  mockupApproveDate?: string | null;
  main?: ProjectRabChangeBoqSnapshot["main"];
  lighting?: ProjectRabChangeBoqSnapshot["lighting"];
  mounting?: ProjectRabChangeBoqSnapshot["mounting"];
  other?: ProjectRabChangeBoqSnapshot["other"];
};

/** One item's counted file version (the current shop drawing file). */
export type CurrentFileRef = {
  shopDrawingItemId: Types.ObjectId | string;
  shopDrawingFileId: Types.ObjectId | string;
};

/**
 * Only the current file version of each item feeds the RAB. `current === null`
 * means "unknown" (legacy change records) and keeps every BOQ.
 */
export function filterCountedBoqs<T extends { shopDrawingFileId: Types.ObjectId | string }>(
  boqs: T[],
  current: CurrentFileRef[] | null | undefined,
): T[] {
  if (!current) return boqs;
  const ids = new Set(current.map((c) => String(c.shopDrawingFileId)));
  return boqs.filter((b) => ids.has(String(b.shopDrawingFileId)));
}

export type VersionSwitchEntry = {
  shopDrawingItemId: string;
  fromFileId: string | null;
  toFileId: string | null;
};

/** Items whose current file changed between two snapshots. */
export function diffCurrentFiles(
  baseline: CurrentFileRef[],
  next: CurrentFileRef[],
): VersionSwitchEntry[] {
  const base = new Map(
    baseline.map((c) => [String(c.shopDrawingItemId), String(c.shopDrawingFileId)]),
  );
  const after = new Map(
    next.map((c) => [String(c.shopDrawingItemId), String(c.shopDrawingFileId)]),
  );
  const out: VersionSwitchEntry[] = [];
  for (const itemId of new Set([...base.keys(), ...after.keys()])) {
    const from = base.get(itemId) ?? null;
    const to = after.get(itemId) ?? null;
    if (from !== to) {
      out.push({ shopDrawingItemId: itemId, fromFileId: from, toFileId: to });
    }
  }
  out.sort((a, b) => a.shopDrawingItemId.localeCompare(b.shopDrawingItemId));
  return out;
}

/** Rebuild material lines from BOQ snaps; keep labour + prices from previous. */
export function syncRabLinesFromBoqs(
  boqs: LeanBoqDoc[],
  previous: ProjectRabLine[],
  plan?: RabUomPlan,
): ProjectRabLine[] {
  const scaffold = aggregateBoqLinesToRab(collectSourceLines(boqs), plan);
  const labour = previous.filter(isLabourLine);
  const prevMaterial = previous
    .filter((l) => !isLabourLine(l))
    .map((l) => ({
      key: l.key,
      unitPrice: l.unitPrice,
      tarifId: l.tarifId ? String(l.tarifId) : undefined,
      origin: l.origin,
      addedAt: l.addedAt,
      addedBy: l.addedBy,
      addReason: l.addReason,
    }));
  const priceMap = new Map(prevMaterial.map((p) => [p.key, p]));
  const merged = mergeRabPricing(
    scaffold,
    prevMaterial.map((p) => ({
      key: p.key,
      unitPrice: p.unitPrice,
      tarifId: p.tarifId,
    })),
  );
  const materials: ProjectRabLine[] = merged.map((row) => {
    const prev = priceMap.get(row.key);
    const line: ProjectRabLine = {
      key: row.key,
      materialItemId: new Types.ObjectId(row.materialItemId),
      itemUomId: new Types.ObjectId(row.itemUomId),
      totalQty: row.totalQty,
      exactQty: row.exactQty,
      origin:
        prev?.origin === "lock" || prev?.origin === "append"
          ? prev.origin
          : "append",
    };
    if (row.rounding) line.rounding = row.rounding;
    if (row.unitPrice) line.unitPrice = row.unitPrice;
    if (row.tarifId && Types.ObjectId.isValid(row.tarifId)) {
      line.tarifId = new Types.ObjectId(row.tarifId);
    }
    if (prev?.addedAt) line.addedAt = prev.addedAt;
    if (prev?.addedBy) line.addedBy = prev.addedBy;
    if (prev?.addReason) line.addReason = prev.addReason;
    return line;
  });
  return [...materials, ...labour];
}

export type RabLineDiffKind = "added" | "removed" | "changed";

export type RabLineDiffEntry = {
  key: string;
  kind: RabLineDiffKind;
  oldTotalQty: string | null;
  newTotalQty: string | null;
  oldUnitPrice: string | null;
  newUnitPrice: string | null;
};

function normPrice(p: string | undefined): string | null {
  if (p === undefined || p === null || String(p).trim() === "") return null;
  return String(p).trim();
}

/** Compare baseline vs next RAB lines (by key). */
export function diffRabLines(
  baseline: ProjectRabLine[],
  next: ProjectRabLine[],
): RabLineDiffEntry[] {
  const baseMap = new Map(baseline.map((l) => [l.key, l]));
  const nextMap = new Map(next.map((l) => [l.key, l]));
  const keys = new Set([...baseMap.keys(), ...nextMap.keys()]);
  const out: RabLineDiffEntry[] = [];
  for (const key of keys) {
    const oldL = baseMap.get(key);
    const newL = nextMap.get(key);
    if (!oldL && newL) {
      out.push({
        key,
        kind: "added",
        oldTotalQty: null,
        newTotalQty: newL.totalQty,
        oldUnitPrice: null,
        newUnitPrice: normPrice(newL.unitPrice),
      });
      continue;
    }
    if (oldL && !newL) {
      out.push({
        key,
        kind: "removed",
        oldTotalQty: oldL.totalQty,
        newTotalQty: null,
        oldUnitPrice: normPrice(oldL.unitPrice),
        newUnitPrice: null,
      });
      continue;
    }
    if (!oldL || !newL) continue;
    const qtyChanged = String(oldL.totalQty) !== String(newL.totalQty);
    const priceChanged = normPrice(oldL.unitPrice) !== normPrice(newL.unitPrice);
    if (qtyChanged || priceChanged) {
      out.push({
        key,
        kind: "changed",
        oldTotalQty: oldL.totalQty,
        newTotalQty: newL.totalQty,
        oldUnitPrice: normPrice(oldL.unitPrice),
        newUnitPrice: normPrice(newL.unitPrice),
      });
    }
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

export type BoqFileDiffKind = "added" | "removed";

export type BoqFileDiffEntry = {
  shopDrawingItemId: string;
  shopDrawingFileId: string;
  kind: BoqFileDiffKind;
};

type BoqFileSnap = BoqLike & {
  shopDrawingItemId: Types.ObjectId | string;
  shopDrawingFileId: Types.ObjectId | string;
};

/** Exact (unrounded) qty contribution of one BOQ file, keyed by RAB line key. */
export function materialQtyByBoqFile(
  boq: BoqLike,
  plan?: RabUomPlan,
): Map<string, string> {
  const rows = aggregateBoqLinesToRab(collectSourceLines([boq]), plan);
  return new Map(rows.map((r) => [r.key, r.exactQty]));
}

export type BoqMaterialDiffKind = "added" | "removed" | "changed";

export type BoqMaterialDiffEntry = {
  shopDrawingFileId: string;
  shopDrawingItemId: string;
  key: string;
  kind: BoqMaterialDiffKind;
  oldTotalQty: string | null;
  newTotalQty: string | null;
};

/**
 * Per shop-drawing file: which material×UOM contributions changed.
 * Avoids painting every elaboration row when RAB aggregates the same item.
 */
export function diffBoqMaterialContributions(
  baseline: BoqFileSnap[],
  next: BoqFileSnap[],
  plan?: RabUomPlan,
): BoqMaterialDiffEntry[] {
  const baseByFile = new Map(
    baseline.map((b) => [String(b.shopDrawingFileId), b] as const),
  );
  const nextByFile = new Map(
    next.map((b) => [String(b.shopDrawingFileId), b] as const),
  );
  const fileIds = new Set([...baseByFile.keys(), ...nextByFile.keys()]);
  const out: BoqMaterialDiffEntry[] = [];

  for (const fileId of fileIds) {
    const baseBoq = baseByFile.get(fileId);
    const nextBoq = nextByFile.get(fileId);
    const itemId = String(
      (nextBoq ?? baseBoq)!.shopDrawingItemId,
    );
    const baseQty = baseBoq
      ? materialQtyByBoqFile(baseBoq, plan)
      : new Map<string, string>();
    const nextQty = nextBoq
      ? materialQtyByBoqFile(nextBoq, plan)
      : new Map<string, string>();
    const keys = new Set([...baseQty.keys(), ...nextQty.keys()]);
    for (const key of keys) {
      const oldTotalQty = baseQty.get(key) ?? null;
      const newTotalQty = nextQty.get(key) ?? null;
      if (oldTotalQty === null && newTotalQty !== null) {
        out.push({
          shopDrawingFileId: fileId,
          shopDrawingItemId: itemId,
          key,
          kind: "added",
          oldTotalQty,
          newTotalQty,
        });
      } else if (oldTotalQty !== null && newTotalQty === null) {
        out.push({
          shopDrawingFileId: fileId,
          shopDrawingItemId: itemId,
          key,
          kind: "removed",
          oldTotalQty,
          newTotalQty,
        });
      } else if (
        oldTotalQty !== null &&
        newTotalQty !== null &&
        oldTotalQty.trim() !== newTotalQty.trim()
      ) {
        out.push({
          shopDrawingFileId: fileId,
          shopDrawingItemId: itemId,
          key,
          kind: "changed",
          oldTotalQty,
          newTotalQty,
        });
      }
    }
  }

  out.sort((a, b) => {
    const byFile = a.shopDrawingFileId.localeCompare(b.shopDrawingFileId);
    if (byFile !== 0) return byFile;
    return a.key.localeCompare(b.key);
  });
  return out;
}

/** BOQs present only in next (added) or only in baseline (removed). */
export function diffBoqFiles(
  baseline: Array<{ shopDrawingItemId: Types.ObjectId | string; shopDrawingFileId: Types.ObjectId | string }>,
  next: Array<{ shopDrawingItemId: Types.ObjectId | string; shopDrawingFileId: Types.ObjectId | string }>,
): BoqFileDiffEntry[] {
  const baseMap = new Map(
    baseline.map((b) => [
      String(b.shopDrawingFileId),
      String(b.shopDrawingItemId),
    ]),
  );
  const nextMap = new Map(
    next.map((b) => [
      String(b.shopDrawingFileId),
      String(b.shopDrawingItemId),
    ]),
  );
  const out: BoqFileDiffEntry[] = [];
  for (const [fileId, itemId] of nextMap) {
    if (!baseMap.has(fileId)) {
      out.push({
        shopDrawingItemId: itemId,
        shopDrawingFileId: fileId,
        kind: "added",
      });
    }
  }
  for (const [fileId, itemId] of baseMap) {
    if (!nextMap.has(fileId)) {
      out.push({
        shopDrawingItemId: itemId,
        shopDrawingFileId: fileId,
        kind: "removed",
      });
    }
  }
  out.sort((a, b) => a.shopDrawingFileId.localeCompare(b.shopDrawingFileId));
  return out;
}

/** Sum line totals (qty × price); null if nothing priced. */
export function sumLineTotals(lines: ProjectRabLine[]): string | null {
  return sumGrandTotal(
    lines.map((line) => computeLineTotal(line.totalQty, line.unitPrice)),
  );
}
