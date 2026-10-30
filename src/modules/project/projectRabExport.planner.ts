/** Pure helpers for RAB Excel export (no I/O). */

import type { PurchaseCharge } from "../../models/purchaseCharge.model";
import { priceStoredCharges } from "../purchasing/purchaseRealization.planner";

export function sanitizeExcelText(raw: string): string {
  const s = String(raw ?? "");
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
}

export function safeFilenamePart(raw: string): string {
  return (
    String(raw ?? "")
      .trim()
      .replace(/[^\w\-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60) || "Project"
  );
}

export function formatExportYmd(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function toRoman(n: number): string {
  if (n <= 0 || n > 3999) return String(n);
  const map: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let rest = n;
  let out = "";
  for (const [v, s] of map) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

export function toLetter(n: number): string {
  if (n <= 0) return String(n);
  let rest = n;
  let out = "";
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(65 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

const SATUAN = [
  "",
  "Satu",
  "Dua",
  "Tiga",
  "Empat",
  "Lima",
  "Enam",
  "Tujuh",
  "Delapan",
  "Sembilan",
  "Sepuluh",
  "Sebelas",
];

function terbilangUnderThousand(n: number): string {
  if (n < 12) return SATUAN[n] ?? "";
  if (n < 20) return `${SATUAN[n - 10]} Belas`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const rem = n % 10;
    return `${SATUAN[tens]} Puluh${rem ? ` ${SATUAN[rem]}` : ""}`;
  }
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  const head = hundreds === 1 ? "Seratus" : `${SATUAN[hundreds]} Ratus`;
  return rem ? `${head} ${terbilangUnderThousand(rem)}` : head;
}

/** Indonesian words for a non-negative rupiah amount (integer). */
export function terbilangRupiah(amount: number): string {
  const n = Math.round(Math.abs(amount));
  if (!Number.isFinite(n) || n === 0) return "Nol Rupiah";

  const scales: Array<[number, string, boolean]> = [
    [1_000_000_000_000, "Triliun", false],
    [1_000_000_000, "Miliar", false],
    [1_000_000, "Juta", false],
    [1_000, "Ribu", true],
  ];

  let rest = n;
  const parts: string[] = [];
  for (const [div, label, seribu] of scales) {
    if (rest < div) continue;
    const chunk = Math.floor(rest / div);
    rest %= div;
    if (seribu && chunk === 1) {
      parts.push(`Seribu`);
    } else {
      parts.push(`${terbilangUnderThousand(chunk)} ${label}`);
    }
  }
  if (rest > 0) parts.push(terbilangUnderThousand(rest));
  return `${parts.join(" ").replace(/\s+/g, " ").trim()} Rupiah`;
}

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

export function lineAmount(line: ExportLineIn): number {
  const qty = Number(line.totalQty);
  const price = Number(line.unitPrice ?? "");
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0;
  return Math.round(qty * price);
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
