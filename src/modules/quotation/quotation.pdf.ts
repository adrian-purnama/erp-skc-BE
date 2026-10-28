import PDFDocument from "pdfkit";
import { formatRp, type QuotationDocument } from "./quotation.document";
import {
  readLogoImageInfo,
  VERIFY_NOTE,
  type QuotationLogo,
  type QuotationVerifyMark,
} from "./quotation.logo";

const MARGIN = 40;
const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const FONT_ITALIC = "Helvetica-Oblique";
const LOGO_MAX_W = 130;
const LOGO_MAX_H = 64;
const CELL_PAD = 4;
const HEADER_FILL = "#D9D9D9";
const LINE_COLOR = "#000000";
const SECTION_FILL = "#F2F2F2";

/**
 * No · Kode · Keterangan · Ukuran · Qty · Satuan · Harga/Unit · Total — sums to
 * A4 content width.
 */
const COLS = [22, 34, 138, 84, 28, 42, 77, 90] as const;
const ALIGN: Array<"left" | "center" | "right"> = [
  "center",
  "center",
  "left",
  "center",
  "center",
  "center",
  "right",
  "right",
];
/** Keterangan column: the item name in bold, its spec lines below. */
const DESC_COL = 2;

type Cell = string | { title: string; lines: string[] };

export function buildQuotationPdf(
  doc: QuotationDocument,
  logo: QuotationLogo | null,
  verify: QuotationVerifyMark | null = null,
): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: {
      Title: doc.meta.right.find(([k]) => k === "No.")?.[1] ?? "Quotation",
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  const left = MARGIN;
  const width = pdf.page.width - MARGIN * 2;
  const bottom = () => pdf.page.height - MARGIN;
  const ensure = (h: number) => {
    if (pdf.y + h > bottom()) pdf.addPage();
  };

  // Letterhead
  const top = pdf.y;
  let textLeft = left;
  let info = logo ? readLogoImageInfo(logo.buffer) : null;
  if (logo && info) {
    try {
      pdf.image(logo.buffer, left, top, { fit: [LOGO_MAX_W, LOGO_MAX_H] });
      textLeft = left + LOGO_MAX_W + 14;
    } catch {
      // Corrupt image: print the letterhead without it rather than failing.
      info = null;
    }
  }
  const textWidth = left + width - textLeft;
  pdf.font(FONT_BOLD).fontSize(14).text(doc.companyName, textLeft, top, {
    width: textWidth,
  });
  pdf.font(FONT).fontSize(9);
  for (const line of doc.letterhead) {
    pdf.text(line, textLeft, pdf.y + 1, { width: textWidth });
  }
  const headBottom = Math.max(pdf.y, info ? top + LOGO_MAX_H : top) + 8;
  pdf
    .moveTo(left, headBottom)
    .lineTo(left + width, headBottom)
    .lineWidth(1.2)
    .strokeColor(LINE_COLOR)
    .stroke();

  // Title
  pdf.font(FONT_BOLD).fontSize(13).text(doc.title, left, headBottom + 16, {
    width,
    align: "center",
  });
  pdf.moveDown(1);

  // Meta block: recipient left, document reference right, side by side.
  pdf.fontSize(10);
  const labelW = 52;
  const gap = 16;
  const halfW = (width - gap) / 2;
  const metaTop = pdf.y;
  const metaColumn = (pairs: Array<[string, string]>, x: number) => {
    pdf.y = metaTop;
    for (const [label, value] of pairs) {
      const y = pdf.y;
      pdf.font(FONT_BOLD).text(label, x, y, { width: labelW });
      pdf.font(FONT).text(`: ${value}`, x + labelW, y, { width: halfW - labelW });
      pdf.y = Math.max(pdf.y, y) + 2;
    }
    return pdf.y;
  };
  const leftEnd = metaColumn(doc.meta.left, left);
  const rightEnd = metaColumn(doc.meta.right, left + halfW + gap);
  pdf.y = Math.max(leftEnd, rightEnd);
  pdf.moveDown(0.8);

  // Lines table
  const cellHeight = (c: Cell, i: number, bold: boolean) => {
    const w = COLS[i]! - CELL_PAD * 2;
    if (typeof c === "string") {
      return pdf.font(bold ? FONT_BOLD : FONT).fontSize(9).heightOfString(c, { width: w });
    }
    const title = pdf.font(FONT_BOLD).fontSize(9).heightOfString(c.title, { width: w });
    const lines =
      c.lines.length > 0
        ? pdf.font(FONT).fontSize(9).heightOfString(c.lines.join("\n"), { width: w })
        : 0;
    return title + lines;
  };
  const drawRow = (
    cells: Cell[],
    opts: { bold?: boolean; fill?: string; aligns?: typeof ALIGN },
  ) => {
    const heights = cells.map((c, i) => cellHeight(c, i, opts.bold === true));
    const h = Math.max(...heights) + CELL_PAD * 2;
    const y = pdf.y;
    let x = left;
    cells.forEach((c, i) => {
      const w = COLS[i]!;
      if (opts.fill) pdf.rect(x, y, w, h).fill(opts.fill).fillColor("#000000");
      pdf.rect(x, y, w, h).lineWidth(0.5).strokeColor(LINE_COLOR).stroke();
      const align = (opts.aligns ?? ALIGN)[i];
      if (typeof c === "string") {
        pdf.font(opts.bold ? FONT_BOLD : FONT).fontSize(9);
        pdf.text(c, x + CELL_PAD, y + CELL_PAD, { width: w - CELL_PAD * 2, align });
      } else {
        pdf.font(FONT_BOLD).fontSize(9);
        pdf.text(c.title, x + CELL_PAD, y + CELL_PAD, { width: w - CELL_PAD * 2, align });
        if (c.lines.length > 0) {
          pdf.font(FONT).fontSize(9);
          pdf.text(c.lines.join("\n"), x + CELL_PAD, pdf.y, {
            width: w - CELL_PAD * 2,
            align,
          });
        }
      }
      x += w;
    });
    pdf.y = y + h;
    return h;
  };
  const header = () =>
    drawRow([...doc.tableHeader], {
      bold: true,
      fill: HEADER_FILL,
      aligns: ALIGN.map(() => "center"),
    });

  const fullRow = (
    label: string,
    amount: string | null,
    opts: { fill?: string; align: "center" | "right" },
  ) => {
    pdf.font(FONT_BOLD).fontSize(9);
    const amountW = amount === null ? 0 : COLS[7];
    const labelW = width - amountW;
    const h = pdf.heightOfString(label, { width: labelW - CELL_PAD * 2 }) + CELL_PAD * 2;
    if (pdf.y + h > bottom()) {
      pdf.addPage();
      header();
    }
    const y = pdf.y;
    if (opts.fill) pdf.rect(left, y, width, h).fill(opts.fill).fillColor("#000000");
    pdf.rect(left, y, labelW, h).lineWidth(0.5).strokeColor(LINE_COLOR).stroke();
    pdf.text(label, left + CELL_PAD, y + CELL_PAD, {
      width: labelW - CELL_PAD * 2,
      align: opts.align,
    });
    if (amount !== null) {
      pdf.rect(left + labelW, y, amountW, h).lineWidth(0.5).stroke();
      pdf.text(amount, left + labelW + CELL_PAD, y + CELL_PAD, {
        width: amountW - CELL_PAD * 2,
        align: "right",
      });
    }
    pdf.y = y + h;
  };

  header();
  for (const row of doc.rows) {
    if (row.type === "section") {
      fullRow(row.title, null, { fill: SECTION_FILL, align: "center" });
      continue;
    }
    if (row.type === "subtotal") {
      fullRow(row.label, formatRp(row.amount), { fill: SECTION_FILL, align: "right" });
      continue;
    }
    const cells: Cell[] = [
      String(row.no),
      row.code,
      { title: row.description, lines: row.descriptions },
      row.dimension,
      new Intl.NumberFormat("id-ID").format(row.qty),
      row.uom,
      formatRp(row.unitPrice),
      formatRp(row.amount),
    ];
    const needed = cellHeight(cells[DESC_COL]!, DESC_COL, false) + CELL_PAD * 2;
    if (pdf.y + needed > bottom()) {
      pdf.addPage();
      header();
    }
    drawRow(cells, {});
  }

  // Totals (right two columns)
  const totalsX = left + COLS.slice(0, 6).reduce((a, b) => a + b, 0);
  const labelColW = COLS[6];
  const amountColW = COLS[7];
  for (const total of doc.totals) {
    ensure(18);
    const y = pdf.y;
    const h = 16;
    pdf.font(total.emphasis ? FONT_BOLD : FONT).fontSize(9);
    pdf.rect(totalsX, y, labelColW, h).lineWidth(0.5).stroke();
    pdf.rect(totalsX + labelColW, y, amountColW, h).lineWidth(0.5).stroke();
    pdf.text(total.label, totalsX + CELL_PAD, y + CELL_PAD, {
      width: labelColW - CELL_PAD * 2,
      align: "right",
    });
    pdf.text(formatRp(total.amount), totalsX + labelColW + CELL_PAD, y + CELL_PAD, {
      width: amountColW - CELL_PAD * 2,
      align: "right",
    });
    pdf.y = y + h;
  }

  pdf.moveDown(0.6);
  ensure(30);
  pdf.font(FONT_ITALIC).fontSize(9).text(doc.terbilang, left, pdf.y, { width });

  // Terms + notes
  if (doc.terms.length > 0 || doc.notes.length > 0) {
    pdf.moveDown(1);
    ensure(40);
    pdf.font(FONT_BOLD).fontSize(10).text("Syarat & Ketentuan", left, pdf.y, { width });
    pdf.font(FONT).fontSize(9);
    for (const t of [...doc.terms, ...doc.notes]) {
      ensure(14);
      pdf.text(t || " ", left, pdf.y + 1, { width });
    }
  }

  // Signature (right) + verification QR (left)
  pdf.moveDown(2);
  ensure(verify ? 110 : 90);
  const blockTop = pdf.y;
  if (verify) {
    const qrSize = 84;
    pdf.image(verify.qrPng, left, blockTop, { width: qrSize, height: qrSize });
    const textX = left + qrSize + 8;
    const textW = width - 180 - qrSize - 24;
    pdf.font(FONT_BOLD).fontSize(8).text("Verify this quotation", textX, blockTop + 4, {
      width: textW,
    });
    pdf
      .font(FONT)
      .fontSize(7)
      .fillColor("#1d4ed8")
      .text(verify.url, textX, pdf.y + 2, { width: textW, link: verify.url })
      .fillColor("#000000");
    pdf.font(FONT).fontSize(7).text(VERIFY_NOTE, textX, pdf.y + 3, { width: textW });
  }
  const signX = left + width - 180;
  pdf.font(FONT).fontSize(10).text(doc.signOff, signX, blockTop, {
    width: 180,
    align: "center",
  });
  pdf.font(FONT_BOLD).text(doc.companyName, signX, pdf.y + 1, {
    width: 180,
    align: "center",
  });
  pdf.y = blockTop + 78;
  pdf
    .font(doc.signerName ? FONT_BOLD : FONT)
    .text(doc.signerName ?? "(....................................)", signX, pdf.y, {
      width: 180,
      align: "center",
      underline: Boolean(doc.signerName),
    });

  pdf.end();
  return done;
}
