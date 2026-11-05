import PDFDocument from "pdfkit";
import { readLogoImageInfo, type QuotationLogo } from "../quotation/quotation.logo";

const MARGIN = 40;
const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const LOGO_MAX_W = 130;
const LOGO_MAX_H = 64;
const CELL_PAD = 4;
const HEADER_FILL = "#D9D9D9";
const LINE_COLOR = "#000000";
const MUTED = "#555555";
const QR_SIZE = 92;

type Align = "left" | "center" | "right";

/**
 * A printable purchasing document (Tanda Terima Barang, Nota Realisasi, Tanda
 * Terima Tagihan, Bukti Pembayaran): built by the service, rendered here.
 */
export type PurchasingDocPdfData = {
  companyName: string;
  letterhead: string[];
  /** e.g. "TANDA TERIMA BARANG", with " (DRAFT)" / " (DIBATALKAN)". */
  title: string;
  subtitle: string | null;
  number: string;
  meta: { left: Array<[string, string]>; right: Array<[string, string]> };
  table: {
    head: string[];
    /** Column widths in points; they should add up to the A4 content width (515). */
    cols: number[];
    align: Align[];
    rows: string[][];
  };
  /** [label, value, bold] rows under the table, the label spanning all but the last column. */
  totals: Array<[string, string, boolean]>;
  /** Small print lines under the totals (e.g. payment status). */
  remarks: string[];
  notes: string[];
  /** QR + link to the document's page (sign-in needed). */
  link: { url: string; qrPng: Buffer; caption: string };
  signDate: string;
  /** [role, signer name or null], spread across the page. */
  signatures: Array<[string, string | null]>;
  /** JPEG / PNG attachments, one per page after the sheet. */
  images: Array<{ name: string; buffer: Buffer }>;
  /** Attachments that cannot be printed (PDF, WEBP, HEIC): listed by name. */
  otherFiles: string[];
};

export function buildPurchasingDocPdf(data: PurchasingDocPdfData, logo: QuotationLogo | null): Promise<Buffer> {
  const pdf = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: data.number } });
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
  const { cols, align } = data.table;

  // Letterhead
  const top = pdf.y;
  let textLeft = left;
  let info = logo ? readLogoImageInfo(logo.buffer) : null;
  if (logo && info) {
    try {
      pdf.image(logo.buffer, left, top, { fit: [LOGO_MAX_W, LOGO_MAX_H] });
      textLeft = left + LOGO_MAX_W + 14;
    } catch {
      info = null;
    }
  }
  const textWidth = left + width - textLeft;
  pdf.font(FONT_BOLD).fontSize(14).text(data.companyName, textLeft, top, { width: textWidth });
  pdf.font(FONT).fontSize(9);
  for (const line of data.letterhead) pdf.text(line, textLeft, pdf.y + 1, { width: textWidth });
  const headBottom = Math.max(pdf.y, info ? top + LOGO_MAX_H : top) + 8;
  pdf.moveTo(left, headBottom).lineTo(left + width, headBottom).lineWidth(1.2).strokeColor(LINE_COLOR).stroke();

  pdf.font(FONT_BOLD).fontSize(13).text(data.title, left, headBottom + 16, { width, align: "center" });
  if (data.subtitle) {
    pdf.font(FONT).fontSize(9).fillColor(MUTED).text(data.subtitle, left, pdf.y + 2, { width, align: "center" });
    pdf.fillColor("#000000");
  }
  pdf.moveDown(1);

  // Meta: two columns.
  pdf.fontSize(10);
  const labelW = 86;
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
  pdf.y = Math.max(metaColumn(data.meta.left, left), metaColumn(data.meta.right, left + halfW + gap));
  pdf.moveDown(0.8);

  // Table
  const row = (cells: string[], opts: { bold?: boolean; fill?: string; center?: boolean } = {}) => {
    pdf.font(opts.bold ? FONT_BOLD : FONT).fontSize(9);
    const h =
      Math.max(...cells.map((c, i) => pdf.heightOfString(c || " ", { width: cols[i]! - CELL_PAD * 2 }))) + CELL_PAD * 2;
    ensure(h);
    const y = pdf.y;
    let x = left;
    cells.forEach((c, i) => {
      const w = cols[i]!;
      if (opts.fill) pdf.rect(x, y, w, h).fill(opts.fill).fillColor("#000000");
      pdf.rect(x, y, w, h).lineWidth(0.5).strokeColor(LINE_COLOR).stroke();
      pdf.font(opts.bold ? FONT_BOLD : FONT).fontSize(9);
      pdf.text(c, x + CELL_PAD, y + CELL_PAD, { width: w - CELL_PAD * 2, align: opts.center ? "center" : align[i] });
      x += w;
    });
    pdf.y = y + h;
  };
  const header = () => row(data.table.head, { bold: true, fill: HEADER_FILL, center: true });
  header();
  for (const cells of data.table.rows) {
    if (pdf.y + 20 > bottom()) {
      pdf.addPage();
      header();
    }
    row(cells);
  }

  // Totals: label spans all but the last column.
  const labelSpan = cols.slice(0, -1).reduce((a, b) => a + b, 0);
  const lastW = cols[cols.length - 1]!;
  for (const [label, value, bold] of data.totals) {
    pdf.font(bold ? FONT_BOLD : FONT).fontSize(9);
    const h =
      Math.max(
        pdf.heightOfString(label, { width: labelSpan - CELL_PAD * 2 }),
        pdf.heightOfString(value, { width: lastW - CELL_PAD * 2 }),
      ) +
      CELL_PAD * 2;
    ensure(h);
    const y = pdf.y;
    pdf.rect(left, y, labelSpan, h).lineWidth(0.5).stroke();
    pdf.rect(left + labelSpan, y, lastW, h).lineWidth(0.5).stroke();
    pdf.text(label, left + CELL_PAD, y + CELL_PAD, { width: labelSpan - CELL_PAD * 2, align: "right" });
    pdf.text(value, left + labelSpan + CELL_PAD, y + CELL_PAD, { width: lastW - CELL_PAD * 2, align: "right" });
    pdf.y = y + h;
  }
  if (data.remarks.length > 0) {
    pdf.font(FONT).fontSize(8).fillColor(MUTED);
    for (const r of data.remarks) {
      ensure(12);
      pdf.text(r, left, pdf.y + 3, { width });
    }
    pdf.fillColor("#000000");
  }

  const notes = [
    ...data.notes,
    ...(data.otherFiles.length > 0 ? [`Lampiran (lihat di aplikasi): ${data.otherFiles.join(", ")}`] : []),
  ];
  if (notes.length > 0) {
    pdf.moveDown(0.8);
    ensure(40);
    pdf.font(FONT_BOLD).fontSize(10).text("Catatan", left, pdf.y, { width });
    pdf.moveDown(0.3);
    pdf.font(FONT).fontSize(9);
    notes.forEach((line, i) => {
      ensure(14);
      const y = pdf.y + 1;
      pdf.text(`${i + 1}.`, left, y, { width: 16, align: "right" });
      pdf.text(line, left + 22, y, { width: width - 22 });
    });
  }

  // QR to the page.
  pdf.moveDown(1);
  ensure(QR_SIZE + 16);
  const boxTop = pdf.y;
  const boxH = QR_SIZE + 12;
  pdf.rect(left, boxTop, width, boxH).lineWidth(0.5).strokeColor("#999999").stroke().strokeColor(LINE_COLOR);
  pdf.image(data.link.qrPng, left + 6, boxTop + 6, { width: QR_SIZE, height: QR_SIZE });
  const tx = left + QR_SIZE + 18;
  const tw = width - QR_SIZE - 24;
  pdf.font(FONT_BOLD).fontSize(10).text(data.number, tx, boxTop + 10, { width: tw });
  pdf.font(FONT).fontSize(9).text(data.link.caption, tx, pdf.y + 3, { width: tw });
  pdf
    .fillColor("#1d4ed8")
    .text(data.link.url, tx, pdf.y + 4, { width: tw, link: data.link.url, underline: true })
    .fillColor("#000000");
  pdf.y = boxTop + boxH;

  // Signatures
  pdf.moveDown(2);
  ensure(110);
  pdf.font(FONT).fontSize(10).text(data.signDate, left, pdf.y, { width, align: "right" });
  pdf.moveDown(0.5);
  const blockTop = pdf.y;
  const count = Math.max(1, data.signatures.length);
  const boxW = Math.min(170, width / count);
  const spacing = count > 1 ? (width - boxW * count) / (count - 1) : 0;
  data.signatures.forEach(([role, name], i) => {
    const x = left + i * (boxW + spacing);
    pdf.font(FONT).fontSize(10).text(role, x, blockTop, { width: boxW, align: "center" });
    pdf
      .font(name ? FONT_BOLD : FONT)
      .text(name ?? "(..............................)", x, blockTop + 70, {
        width: boxW,
        align: "center",
        underline: Boolean(name),
      });
  });

  // Attachments: one image per page, fitted under its name.
  for (const img of data.images) {
    pdf.addPage();
    pdf.font(FONT_BOLD).fontSize(10).text(`Lampiran · ${img.name}`, left, MARGIN, { width });
    try {
      pdf.image(img.buffer, left, pdf.y + 8, {
        fit: [width, pdf.page.height - MARGIN * 2 - 30],
        align: "center",
      });
    } catch {
      pdf.font(FONT).fontSize(9).text("(Gambar tidak dapat dicetak; lihat di aplikasi.)", left, pdf.y + 8, { width });
    }
  }

  pdf.end();
  return done;
}
