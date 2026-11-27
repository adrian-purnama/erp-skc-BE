/** Pure helpers for RAB Excel export (no I/O). */

import type { PurchaseCharge } from "../../models/charge.schema";
import { priceStoredCharges } from "../../utils/charges";
import { computeLineTotal } from "./projectRab.planner";
import { safeFilenamePart, formatExportYmd, toRoman, toLetter } from "../../utils/document/text";

export type ExportLineKind = "material" | "labour";

export type ExportLineIn = {
  key: string;
  materialItemId: string;
  materialCode: string;
  materialName: string;
  uomSymbol: string;
  totalQty: string;
  unitPrice: string | null;
  origin: string | null;
  addReason: string | null;
  /** Folder names from root → leaf (0–2+ levels). */
  folderPath: string[];
  vendorName: string | null;
  /** e.g. Tambah (Rev 2) */
  keterangan: string;
  kind: ExportLineKind;
};

export type ExportSection = {
  name: string;
  roman: string;
  subsections: Array<{
    name: string | null;
    letter: string | null;
    lines: ExportLineIn[];
  }>;
};

export function missingPriceLines(lines: ExportLineIn[]): ExportLineIn[] {
  return lines.filter(
    (l) => l.unitPrice === null || String(l.unitPrice).trim() === "",
  );
}

/** Whole-rupiah line amount, the same rounding as the RAB page (`computeLineTotal`). */
export function lineAmount(line: ExportLineIn): number {
  try {
    return Number(computeLineTotal(line.totalQty, line.unitPrice) ?? "0");
  } catch {
    return 0;
  }
}

export function sumLineAmounts(lines: ExportLineIn[]): number {
  return lines.reduce((s, l) => s + lineAmount(l), 0);
}

export type ExportChargeRow = {
  /** Label with the rate for percent charges, e.g. "PPN (11%)". */
  label: string;
  /** Percent of the subtotal; null for fixed charges. */
  rate: number | null;
  /** Integer rupiah, priced on `subtotal`. */
  amount: number;
};

/** RAB additional costs as export rows, priced on the line subtotal. */
export function exportChargeRows(
  subtotal: number,
  charges: PurchaseCharge[],
): ExportChargeRow[] {
  return priceStoredCharges(String(subtotal), charges).charges.map((c) => {
    const rate = c.kind === "percent" ? Number(c.rate ?? 0) : null;
    return {
      label: rate === null ? c.label : `${c.label} (${rate}%)`,
      rate,
      amount: Number(c.amount),
    };
  });
}

/** Group lines into folder sections (depth1) / subsections (depth2). */
export function buildSections(lines: ExportLineIn[]): ExportSection[] {
  type Bucket = Map<string, ExportLineIn[]>;
  const bySection = new Map<string, Bucket>();

  for (const line of lines) {
    const section = line.folderPath[0]?.trim() || "";
    const sub = line.folderPath[1]?.trim() || "";
    let bucket = bySection.get(section);
    if (!bucket) {
      bucket = new Map();
      bySection.set(section, bucket);
    }
    const list = bucket.get(sub) ?? [];
    list.push(line);
    bucket.set(sub, list);
  }

  const sectionNames = [...bySection.keys()].sort((a, b) =>
    a.localeCompare(b, "id"),
  );

  return sectionNames.map((name, si) => {
    const bucket = bySection.get(name)!;
    const subKeys = [...bucket.keys()].sort((a, b) => {
      if (a === "") return -1;
      if (b === "") return 1;
      return a.localeCompare(b, "id");
    });
    const hasRealSubs = subKeys.some((k) => k !== "");
    let letterIdx = 0;
    const subsections = subKeys.map((sub) => {
      const nameOrNull = sub === "" ? null : sub;
      let letter: string | null = null;
      if (hasRealSubs && nameOrNull !== null) {
        letterIdx += 1;
        letter = toLetter(letterIdx);
      }
      return {
        name: nameOrNull,
        letter,
        lines: (bucket.get(sub) ?? [])
          .slice()
          .sort((a, b) => a.materialName.localeCompare(b.materialName, "id")),
      };
    });

    return {
      name,
      roman: toRoman(si + 1),
      subsections,
    };
  });
}

export function buildExportFilename(opts: {
  projectCode: string;
  projectName: string;
  revision: number;
  draft: boolean;
  kind: "formal" | "data";
  date?: Date;
}): string {
  const code = safeFilenamePart(opts.projectCode);
  const name = safeFilenamePart(opts.projectName);
  const ymd = formatExportYmd(opts.date);
  const rev = opts.draft ? `Rev${opts.revision}_DRAFT` : `Rev${opts.revision}`;
  const infix = opts.kind === "data" ? "_DATA" : "";
  return `RAB_${code}_${name}_${rev}${infix}_${ymd}.xlsx`;
}
