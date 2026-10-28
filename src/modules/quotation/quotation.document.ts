import type { ProjectQuotationOutDto } from "../../dto/projectQuotation.dto";
import { terbilangRupiah } from "../project/projectRabExport.planner";

export type QuotationDocumentRow =
  | {
      type: "line";
      no: number;
      /** Kode, e.g. "SA1" (empty for labour). */
      code: string;
      /** Item name, printed bold. */
      description: string;
      /** Keterangan lines printed under the name. */
      descriptions: string[];
      /** Ukuran, e.g. "600 x 3 x 500". */
      dimension: string;
      qty: number;
      uom: string;
      unitPrice: number;
      amount: number;
    }
  /** Category header spanning the whole table. */
  | { type: "section"; title: string }
  /** "SUB TOTAL I" etc. after each category. */
  | { type: "subtotal"; label: string; amount: number };

/** Printed content shared by the Excel and PDF quotation layouts. */
export type QuotationDocument = {
  companyName: string;
  letterhead: string[];
  title: string;
  /** Recipient on the left, document reference on the right. */
  meta: { left: Array<[string, string]>; right: Array<[string, string]> };
  tableHeader: string[];
  rows: QuotationDocumentRow[];
  totals: Array<{ label: string; amount: number; emphasis: boolean }>;
  terbilang: string;
  terms: string[];
  notes: string[];
  signOff: string;
  /** Issuer full name under the signature; null on drafts (blank line). */
  signerName: string | null;
};

function documentRows(q: ProjectQuotationOutDto): QuotationDocumentRow[] {
  const lineRow = (idx: number, no: number): QuotationDocumentRow => {
    const line = q.lines[idx]!;
    return {
      type: "line",
      no,
      code: line.code,
      description: line.description,
      descriptions: line.descriptions,
      dimension: line.dimension,
      qty: Number(line.qty),
      uom: line.uom,
      unitPrice: Number(line.unitPrice),
      amount: Number(line.lineTotal),
    };
  };
  if (q.sections.length === 0) return q.lines.map((_, idx) => lineRow(idx, idx + 1));
  // Numbering restarts per category, like the RAB layout clients expect.
  return q.sections.flatMap((section): QuotationDocumentRow[] => [
    { type: "section", title: section.title },
    ...section.lineIndexes.map((idx, i) => lineRow(idx, i + 1)),
    {
      type: "subtotal",
      label: `SUB TOTAL ${section.numeral}`,
      amount: Number(section.subtotal),
    },
  ]);
}

export function formatLongDate(d: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(d);
}

function ymdToLong(ymd: string): string {
  return formatLongDate(new Date(`${ymd}T00:00:00+07:00`));
}

export function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function formatRp(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.abs(amount))}`;
}

export function buildQuotationDocument(
  q: ProjectQuotationOutDto,
  now = new Date(),
): QuotationDocument {
  // One printed line per entry: multi-line addresses split, website on its own
  // line so nothing wraps beside the logo. With branches, each address block
  // is labelled like the printed letterhead ("Head Office:" / "Branch Office:").
  const branches = q.company.branchOfficeAddresses
    .map(splitLines)
    .filter((lines) => lines.length > 0);
  const labelled = (label: string, lines: string[]) =>
    lines.map((l, i) => (i === 0 ? `${label}: ${l}` : l));
  const letterhead = [
    ...(branches.length > 0
      ? [
          ...labelled("Head Office", splitLines(q.company.address)),
          ...branches.flatMap((lines) => labelled("Branch Office", lines)),
        ]
      : splitLines(q.company.address)),
    [q.company.phone && `Telp: ${q.company.phone}`, q.company.email]
      .filter(Boolean)
      .join(" · "),
    q.company.website,
    q.company.npwp && `NPWP: ${q.company.npwp}`,
  ].filter((line): line is string => Boolean(line));

  const issueDate = q.issuedAt ? new Date(q.issuedAt) : now;
  const present = (pairs: Array<[string, string]>) =>
    pairs.filter(([, value]) => Boolean(value));
  const meta: QuotationDocument["meta"] = {
    left: present([
      ["Kepada", q.customer.name],
      ["Alamat", q.customer.address],
      [
        "Up.",
        `${q.contact.gender === "female" ? "Ibu" : "Bapak"} ${q.contact.name}`.trim(),
      ],
    ]),
    right: present([
      ["No.", q.quotationNumber],
      ["Tanggal", formatLongDate(issueDate)],
      ["Perihal", q.subject],
    ]),
  };

  const totals: QuotationDocument["totals"] = [
    { label: "Subtotal", amount: Number(q.totals.subtotal), emphasis: false },
  ];
  if (Number(q.totals.discountAmount) > 0) {
    totals.push({
      label: q.discountType === "percent" ? `Diskon ${q.discountValue}%` : "Diskon",
      amount: -Number(q.totals.discountAmount),
      emphasis: false,
    });
    totals.push({ label: "DPP", amount: Number(q.totals.taxBase), emphasis: false });
  }
  if (Number(q.taxPercent) > 0) {
    totals.push({
      label: `PPN ${q.taxPercent}%`,
      amount: Number(q.totals.taxAmount),
      emphasis: false,
    });
  }
  totals.push({ label: "Total", amount: Number(q.totals.grandTotal), emphasis: true });

  const terms: string[] = [];
  if (q.termOfPaymentText) terms.push(`Termin Pembayaran: ${q.termOfPaymentText}`);
  if (q.validUntil) terms.push(`Berlaku Hingga: ${ymdToLong(q.validUntil)}`);

  return {
    companyName: q.company.name,
    letterhead,
    title: q.status === "draft" ? "PENAWARAN HARGA (DRAFT)" : "PENAWARAN HARGA",
    meta,
    tableHeader: [
      "No",
      "Kode",
      "Keterangan",
      "Ukuran\n(p x tebal x t mm)",
      "Qty",
      "Satuan",
      "Harga/Unit",
      "Total",
    ],
    rows: documentRows(q),
    totals,
    terbilang: `Terbilang: ${terbilangRupiah(Number(q.totals.grandTotal))}`,
    terms,
    notes: q.notes ? q.notes.split(/\r?\n/) : [],
    signOff: "Hormat kami,",
    signerName: q.issuedByName,
  };
}
