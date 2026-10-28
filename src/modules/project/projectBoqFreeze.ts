import type { Types } from "mongoose";
import type {
  ProjectShopDrawingBoqBase,
  ProjectShopDrawingBoqFinishing,
  ProjectShopDrawingBoqInterface,
  ProjectShopDrawingBoqLine,
  ProjectShopDrawingBoqMain,
} from "../../models/projectShopDrawingBoq/projectShopDrawingBoq.model";

export type BoqLineStamp = {
  addedAt: Date;
  addedBy: Types.ObjectId;
  addReason: string;
};

type LineLike = {
  materialItemId: Types.ObjectId | string;
  itemUomId: Types.ObjectId | string;
  formula: string;
  inputs: { v1: string; v2?: string; v3?: string };
  yieldQty?: string;
  qtyPerUnit: string;
  spec?: string;
  addedAt?: Date;
  addedBy?: Types.ObjectId;
  addReason?: string;
};

export type BoqSnapshot = {
  makeQty: string;
  main: ProjectShopDrawingBoqMain;
  lighting: { lines: ProjectShopDrawingBoqLine[] };
  mounting: { type: string; lines: ProjectShopDrawingBoqLine[] };
  other: { lines: ProjectShopDrawingBoqLine[] };
};

function idStr(id: Types.ObjectId | string): string {
  return String(id);
}

function inputsKey(inputs: LineLike["inputs"]): string {
  return [inputs.v1, inputs.v2 ?? "", inputs.v3 ?? ""].join("|");
}

/** Stable content fingerprint for a material line (ignores post-lock stamps). */
export function lineContentKey(line: LineLike): string {
  return [
    idStr(line.materialItemId),
    idStr(line.itemUomId),
    line.formula.trim(),
    inputsKey(line.inputs),
    line.yieldQty?.trim() || "1",
    line.qtyPerUnit.trim(),
    (line.spec ?? "").trim(),
  ].join("::");
}

type BoqDiff = {
  violations: string[];
  additions: boolean;
};

function lineListPrefixDiff(
  previous: LineLike[],
  next: LineLike[],
  path: string,
  diff: BoqDiff,
): void {
  if (next.length < previous.length) {
    diff.violations.push(
      `RAB is locked: cannot remove lines from ${path} (frozen content)`,
    );
  }
  for (let i = 0; i < Math.min(previous.length, next.length); i += 1) {
    if (lineContentKey(previous[i]!) !== lineContentKey(next[i]!)) {
      diff.violations.push(
        `RAB is locked: cannot change frozen line in ${path}[${i}]`,
      );
    }
  }
  if (next.length > previous.length) diff.additions = true;
}

function finishingKey(f: ProjectShopDrawingBoqFinishing): string {
  return `${f.placement}:${f.finishingOrder}`;
}

/** One traversal shared by the lock guard and the additions check. */
function inspectBoqAppendOnly(
  previous: BoqSnapshot,
  next: BoqSnapshot,
): BoqDiff {
  const diff: BoqDiff = { violations: [], additions: false };

  if (previous.makeQty.trim() !== next.makeQty.trim()) {
    diff.violations.push("RAB is locked: makeQty cannot be changed");
  }
  if (previous.mounting.type !== next.mounting.type) {
    diff.violations.push("RAB is locked: mounting type cannot be changed");
  }

  const prevParts = previous.main.parts ?? [];
  const nextParts = next.main.parts ?? [];
  const prevPartByKey = new Map(prevParts.map((p) => [p.key, p]));

  for (const prevPart of prevParts) {
    const nextPart = nextParts.find((p) => p.key === prevPart.key);
    if (!nextPart) {
      diff.violations.push(
        `RAB is locked: cannot remove part "${prevPart.key}"`,
      );
      continue;
    }
    if ((prevPart.label ?? "") !== (nextPart.label ?? "")) {
      diff.violations.push(
        `RAB is locked: cannot change label on part "${prevPart.key}"`,
      );
    }

    const nextBaseByKey = new Map(
      (nextPart.bases ?? []).map((b) => [b.key, b]),
    );
    for (const prevBase of prevPart.bases ?? []) {
      const nextBase = nextBaseByKey.get(prevBase.key);
      if (!nextBase) {
        diff.violations.push(
          `RAB is locked: cannot remove core "${prevBase.key}"`,
        );
        continue;
      }
      if (lineContentKey(prevBase) !== lineContentKey(nextBase)) {
        diff.violations.push(
          `RAB is locked: cannot change frozen core "${prevBase.key}"`,
        );
      }

      const nextFinByKey = new Map(
        (nextBase.finishings ?? []).map((f) => [finishingKey(f), f]),
      );
      for (const prevFin of prevBase.finishings ?? []) {
        const key = finishingKey(prevFin);
        const nextFin = nextFinByKey.get(key);
        if (!nextFin) {
          diff.violations.push(
            `RAB is locked: cannot remove finishing ${key} on "${prevBase.key}"`,
          );
          continue;
        }
        lineListPrefixDiff(
          prevFin.lines,
          nextFin.lines,
          `finishing ${key} on ${prevBase.key}`,
          diff,
        );
      }

      // Appended finishings/lines are allowed.
      if (
        (nextBase.finishings?.length ?? 0) >
        (prevBase.finishings?.length ?? 0)
      ) {
        diff.additions = true;
      }
    }
  }

  // Appended parts/bases are allowed.
  for (const nextPart of nextParts) {
    const prevPart = prevPartByKey.get(nextPart.key);
    if (!prevPart) {
      diff.additions = true;
      continue;
    }
    for (const nextBase of nextPart.bases ?? []) {
      if (!(prevPart.bases ?? []).some((b) => b.key === nextBase.key)) {
        diff.additions = true;
      }
    }
  }

  lineListPrefixDiff(
    previous.main.assembly?.lines ?? [],
    next.main.assembly?.lines ?? [],
    "assembly",
    diff,
  );
  lineListPrefixDiff(
    previous.lighting?.lines ?? [],
    next.lighting?.lines ?? [],
    "lighting",
    diff,
  );
  lineListPrefixDiff(
    previous.mounting?.lines ?? [],
    next.mounting?.lines ?? [],
    "mounting",
    diff,
  );
  lineListPrefixDiff(
    previous.other?.lines ?? [],
    next.other?.lines ?? [],
    "other",
    diff,
  );

  return diff;
}

/**
 * When BOQ content is frozen after RAB lock: previous content must remain
 * unchanged; only appends (new bases / finishings / trailing section lines) OK.
 */
export function assertBoqAppendOnly(
  previous: BoqSnapshot,
  next: BoqSnapshot,
): void {
  const { violations } = inspectBoqAppendOnly(previous, next);
  if (violations.length > 0) {
    throw new Error(violations[0]);
  }
}

export function boqHasAdditions(
  previous: BoqSnapshot | null,
  next: BoqSnapshot,
): boolean {
  if (!previous) return true;
  const { violations, additions } = inspectBoqAppendOnly(previous, next);
  return violations.length > 0 || additions;
}

function stampLine(
  line: ProjectShopDrawingBoqLine,
  stamp: BoqLineStamp,
): ProjectShopDrawingBoqLine {
  if (line.addedAt) return line;
  return {
    ...line,
    addedAt: stamp.addedAt,
    addedBy: stamp.addedBy,
    addReason: stamp.addReason,
  };
}

function stampLineList(
  previous: ProjectShopDrawingBoqLine[],
  next: ProjectShopDrawingBoqLine[],
  stamp: BoqLineStamp,
): ProjectShopDrawingBoqLine[] {
  return next.map((line, i) => {
    if (i < previous.length) {
      // Preserve prior stamps on frozen prefix
      const prev = previous[i]!;
      return {
        ...line,
        ...(prev.addedAt ? { addedAt: prev.addedAt } : {}),
        ...(prev.addedBy ? { addedBy: prev.addedBy } : {}),
        ...(prev.addReason ? { addReason: prev.addReason } : {}),
      };
    }
    return stampLine(line, stamp);
  });
}

function stampBase(
  previous: ProjectShopDrawingBoqBase | undefined,
  next: ProjectShopDrawingBoqBase,
  stamp: BoqLineStamp,
): ProjectShopDrawingBoqBase {
  const prevFins = previous?.finishings ?? [];
  const finishings = (next.finishings ?? []).map((nf) => {
    const pf = prevFins.find((f) => finishingKey(f) === finishingKey(nf));
    return {
      ...nf,
      lines: stampLineList(pf?.lines ?? [], nf.lines, stamp),
    };
  });

  const core: ProjectShopDrawingBoqBase = {
    ...next,
    finishings,
  };
  if (!previous) {
    return {
      ...stampLine(next, stamp),
      key: next.key,
      ...(next.spec ? { spec: next.spec } : {}),
      finishings,
    };
  }
  // Preserve core stamps if any
  if (previous.addedAt) {
    core.addedAt = previous.addedAt;
    if (previous.addedBy) core.addedBy = previous.addedBy;
    if (previous.addReason) core.addReason = previous.addReason;
  }
  return core;
}

/** Stamp newly appended lines; keep existing stamps on frozen lines. */
export function stampBoqAdditions(
  previous: BoqSnapshot | null,
  next: BoqSnapshot,
  stamp: BoqLineStamp,
): BoqSnapshot {
  if (!previous) {
    return {
      makeQty: next.makeQty,
      main: {
        parts: next.main.parts.map((part) => ({
          ...part,
          bases: (part.bases ?? []).map((b) => stampBase(undefined, b, stamp)),
        })),
        assembly: {
          lines: stampLineList([], next.main.assembly?.lines ?? [], stamp),
        },
      },
      lighting: {
        lines: stampLineList([], next.lighting?.lines ?? [], stamp),
      },
      mounting: {
        type: next.mounting.type,
        lines: stampLineList([], next.mounting?.lines ?? [], stamp),
      },
      other: {
        lines: stampLineList([], next.other?.lines ?? [], stamp),
      },
    };
  }

  const prevPartByKey = new Map(previous.main.parts.map((p) => [p.key, p]));
  return {
    makeQty: next.makeQty,
    main: {
      parts: next.main.parts.map((part) => {
        const prevPart = prevPartByKey.get(part.key);
        const prevBaseByKey = new Map(
          (prevPart?.bases ?? []).map((b) => [b.key, b]),
        );
        return {
          ...part,
          bases: (part.bases ?? []).map((b) =>
            stampBase(prevBaseByKey.get(b.key), b, stamp),
          ),
        };
      }),
      assembly: {
        lines: stampLineList(
          previous.main.assembly?.lines ?? [],
          next.main.assembly?.lines ?? [],
          stamp,
        ),
      },
    },
    lighting: {
      lines: stampLineList(
        previous.lighting?.lines ?? [],
        next.lighting?.lines ?? [],
        stamp,
      ),
    },
    mounting: {
      type: next.mounting.type,
      lines: stampLineList(
        previous.mounting?.lines ?? [],
        next.mounting?.lines ?? [],
        stamp,
      ),
    },
    other: {
      lines: stampLineList(
        previous.other?.lines ?? [],
        next.other?.lines ?? [],
        stamp,
      ),
    },
  };
}

/** Jakarta calendar date YYYY-MM-DD for grouping post-lock adds. */
export function jakartaDateKey(when: Date | string): string {
  const d = typeof when === "string" ? new Date(when) : when;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
