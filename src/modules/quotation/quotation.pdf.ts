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

/** No · Uraian · Qty · Satuan · Harga Satuan · Jumlah — sums to A4 content width. */
const COLS = [28, 212, 45, 50, 90, 90] as const;
const ALIGN: Array<"left" | "center" | "right"> = [
  "center",
  "left",
  "center",
  "center",
  "right",
  "right",
];

export function buildQuotationPdf(
  doc: QuotationDocument,
  logo: QuotationLogo | null,
  verify: QuotationVerifyMark | null = null,
): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: { Title: doc.meta.find(([k]) => k === "No.")?.[1] ?? "Quotation" },
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

  // Meta block
  pdf.fontSize(10);
  const labelW = 60;
  for (const [label, value] of doc.meta) {
    const y = pdf.y;
    pdf.font(FONT_BOLD).text(label, left, y, { width: labelW });
    pdf.font(FONT).text(`: ${value}`, left + labelW, y, { width: width - labelW });
    pdf.y = Math.max(pdf.y, y) + 2;
  }
  pdf.moveDown(0.8);

  // Lines table
  const drawRow = (
    cells: string[],
    opts: { bold?: boolean; fill?: string; aligns?: typeof ALIGN },
  ) => {
    pdf.font(opts.bold ? FONT_BOLD : FONT).fontSize(9);
    const heights = cells.map(
      (c, i) => pdf.heightOfString(c, { width: COLS[i]! - CELL_PAD * 2 }),
    );
    const h = Math.max(...heights) + CELL_PAD * 2;
    const y = pdf.y;
    let x = left;
    cells.forEach((c, i) => {
      const w = COLS[i]!;
      if (opts.fill) pdf.rect(x, y, w, h).fill(opts.fill).fillColor("#000000");
      pdf.rect(x, y, w, h).lineWidth(0.5).strokeColor(LINE_COLOR).stroke();
      pdf.text(c, x + CELL_PAD, y + CELL_PAD, {
        width: w - CELL_PAD * 2,
        align: (opts.aligns ?? ALIGN)[i],
      });
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

  header();
  for (const row of doc.rows) {
    const cells = [
      String(row.no),
      row.description,
      new Intl.NumberFormat("id-ID").format(row.qty),
      row.uom,
      formatRp(row.unitPrice),
      formatRp(row.amount),
    ];
    pdf.font(FONT).fontSize(9);
    const needed =
      pdf.heightOfString(row.description, { width: COLS[1] - CELL_PAD * 2 }) +
      CELL_PAD * 2;
    if (pdf.y + needed > bottom()) {
      pdf.addPage();
      header();
    }
    drawRow(cells, {});
  }

  // Totals (right two columns)
  const totalsX = left + COLS[0] + COLS[1] + COLS[2] + COLS[3];
  const labelColW = COLS[4];
  const amountColW = COLS[5];
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
  pdf.y = blockTop + 70;
  pdf.font(FONT_BOLD).text(doc.companyName, signX, pdf.y, {
    width: 180,
    align: "center",
  });

  pdf.end();
  return done;
}
