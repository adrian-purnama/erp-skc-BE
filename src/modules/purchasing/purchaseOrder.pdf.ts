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

/**
 * Everything printed on a PO; built by the service, rendered here.
 * `vendor`: the PO sent to the vendor (or its draft).
 * `approval`: the request for approval, for management, with RAB prices and a QR link.
 */
export type PoPdfData = {
  layout: "vendor" | "approval";
  companyName: string;
  letterhead: string[];
  /** "PESANAN PEMBELIAN", "PENGAJUAN PEMBELIAN", optional " (DRAFT)". */
  title: string;
  /** Small line under the title, e.g. "Menunggu persetujuan". */
  subtitle: string | null;
  number: string;
  meta: { left: Array<[string, string]>; right: Array<[string, string]> };
  lines: Array<{
    code: string;
    name: string;
    /** Extra lines under the name (approval layout: reasons / flags). */
    details: string[];
    qty: string;
    uom: string;
    unitPrice: string;
    /** Approval layout only. */
    rabPrice: string;
    /** Approval layout: unit price is above the RAB price. */
    aboveRab: boolean;
    amount: string;
  }>;
  total: string;
  /** Approval layout: total at RAB prices and the difference. */
  budget: { rabTotal: string; difference: string; over: boolean } | null;
  notes: string[];
  /** Approval layout: QR + link to the approval page. */
  approvalLink: { url: string; qrPng: Buffer } | null;
  signDate: string;
  /** [role, name] left and right, e.g. ["Diajukan oleh,", "Budi"]. */
  /** [role, signer name or null, approval date or null], spread across the page. */
  signatures: Array<[string, string | null, string | null]>;
};

type Align = "left" | "center" | "right";

/** No · Kode · Material · Qty · Satuan · Harga satuan · Jumlah — A4 content width. */
const VENDOR_COLS = [24, 70, 181, 50, 40, 70, 80];
const VENDOR_ALIGN: Align[] = ["center", "left", "left", "right", "center", "right", "right"];
const VENDOR_HEAD = ["No", "Kode", "Material", "Qty", "Satuan", "Harga satuan", "Jumlah"];

/** No · Kode · Material · Qty · Satuan · Harga RAB · Harga · Jumlah. */
const APPROVAL_COLS = [22, 54, 135, 36, 44, 70, 76, 78];
const APPROVAL_ALIGN: Align[] = ["center", "left", "left", "right", "center", "right", "right", "right"];
const APPROVAL_HEAD = ["No", "Kode", "Material", "Qty", "Satuan", "Harga RAB", "Harga", "Jumlah"];

export function buildPoPdf(data: PoPdfData, logo: QuotationLogo | null): Promise<Buffer> {
  const pdf = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: data.number } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  const approval = data.layout === "approval";
  const cols = approval ? APPROVAL_COLS : VENDOR_COLS;
  const aligns = approval ? APPROVAL_ALIGN : VENDOR_ALIGN;
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
      info = null;
    }
  }
  const textWidth = left + width - textLeft;
  pdf.font(FONT_BOLD).fontSize(14).text(data.companyName, textLeft, top, { width: textWidth });
  pdf.font(FONT).fontSize(9);
  for (const line of data.letterhead) {
    pdf.text(line, textLeft, pdf.y + 1, { width: textWidth });
  }
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
  const labelW = 80;
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

  // Lines
  type Cell = string | { text: string; details: string[] };
  const cellText = (c: Cell) => (typeof c === "string" ? c : c.text);
  const cellHeight = (c: Cell, w: number, bold: boolean) => {
    const inner = w - CELL_PAD * 2;
    const main = pdf.font(bold ? FONT_BOLD : FONT).fontSize(9).heightOfString(cellText(c) || " ", { width: inner });
    if (typeof c === "string" || c.details.length === 0) return main;
    return main + pdf.font(FONT).fontSize(7.5).heightOfString(c.details.join("\n"), { width: inner });
  };
  const row = (cells: Cell[], opts: { bold?: boolean; fill?: string; center?: boolean } = {}) => {
    const h = Math.max(...cells.map((c, i) => cellHeight(c, cols[i]!, opts.bold === true))) + CELL_PAD * 2;
    ensure(h);
    const y = pdf.y;
    let x = left;
    cells.forEach((c, i) => {
      const w = cols[i]!;
      if (opts.fill) pdf.rect(x, y, w, h).fill(opts.fill).fillColor("#000000");
      pdf.rect(x, y, w, h).lineWidth(0.5).strokeColor(LINE_COLOR).stroke();
      const align = opts.center ? "center" : aligns[i];
      pdf.font(opts.bold ? FONT_BOLD : FONT).fontSize(9);
      pdf.text(cellText(c), x + CELL_PAD, y + CELL_PAD, { width: w - CELL_PAD * 2, align });
      if (typeof c !== "string" && c.details.length > 0) {
        pdf.font(FONT).fontSize(7.5).fillColor(MUTED);
        pdf.text(c.details.join("\n"), x + CELL_PAD, pdf.y, { width: w - CELL_PAD * 2, align });
        pdf.fillColor("#000000");
      }
      x += w;
    });
    pdf.y = y + h;
  };
  const header = () =>
    row(approval ? APPROVAL_HEAD : VENDOR_HEAD, { bold: true, fill: HEADER_FILL, center: true });
  header();
  data.lines.forEach((l, i) => {
    if (pdf.y + 20 > bottom()) {
      pdf.addPage();
      header();
    }
    const material: Cell = { text: l.name, details: l.details };
    row(
      approval
        ? [String(i + 1), l.code, material, l.qty, l.uom, l.rabPrice, `${l.aboveRab ? "* " : ""}${l.unitPrice}`, l.amount]
        : [String(i + 1), l.code, material, l.qty, l.uom, l.unitPrice, l.amount],
    );
  });

  // Totals: label spans all but the last column.
  const labelSpan = cols.slice(0, -1).reduce((a, b) => a + b, 0);
  const lastW = cols[cols.length - 1]!;
  const totalRow = (label: string, value: string, bold: boolean) => {
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
  };
  totalRow("Total", data.total, true);
  if (data.budget) {
    totalRow("Total dengan harga RAB", data.budget.rabTotal, false);
    totalRow(data.budget.over ? "Selisih (di atas RAB)" : "Selisih (di bawah / sama dengan RAB)", data.budget.difference, false);
  }
  if (approval && data.lines.some((l) => l.aboveRab)) {
    pdf.font(FONT).fontSize(7.5).fillColor(MUTED).text("* Harga di atas harga RAB.", left, pdf.y + 2, { width });
    pdf.fillColor("#000000");
  }

  if (data.notes.length > 0) {
    pdf.moveDown(0.8);
    ensure(40);
    pdf.font(FONT_BOLD).fontSize(10).text("Catatan", left, pdf.y, { width });
    pdf.moveDown(0.3);
    pdf.font(FONT).fontSize(9);
    data.notes.forEach((line, i) => {
      ensure(14);
      const y = pdf.y + 1;
      pdf.text(`${i + 1}.`, left, y, { width: 16, align: "right" });
      pdf.text(line, left + 22, y, { width: width - 22 });
    });
  }

  // Approval: QR to the approval page.
  if (data.approvalLink) {
    pdf.moveDown(1);
    ensure(QR_SIZE + 16);
    const boxTop = pdf.y;
    const boxH = QR_SIZE + 12;
    pdf.rect(left, boxTop, width, boxH).lineWidth(0.5).strokeColor("#999999").stroke().strokeColor(LINE_COLOR);
    pdf.image(data.approvalLink.qrPng, left + 6, boxTop + 6, { width: QR_SIZE, height: QR_SIZE });
    const tx = left + QR_SIZE + 18;
    const tw = width - QR_SIZE - 24;
    pdf.font(FONT_BOLD).fontSize(10).text("Persetujuan online", tx, boxTop + 10, { width: tw });
    pdf
      .font(FONT)
      .fontSize(9)
      .text("Pindai QR atau klik tautan di bawah untuk melihat dan menyetujui / menolak pengajuan ini (perlu login ke aplikasi).", tx, pdf.y + 3, { width: tw });
    pdf
      .fillColor("#1d4ed8")
      .text(data.approvalLink.url, tx, pdf.y + 4, { width: tw, link: data.approvalLink.url, underline: true })
      .fillColor("#000000");
    pdf.y = boxTop + boxH;
  }

  // Signatures
  pdf.moveDown(2);
  ensure(110);
  pdf.font(FONT).fontSize(10).text(data.signDate, left, pdf.y, { width, align: "right" });
  pdf.moveDown(0.5);
  const blockTop = pdf.y;
  const count = Math.max(1, data.signatures.length);
  const boxW = Math.min(180, width / count);
  const spacing = count > 1 ? (width - boxW * count) / (count - 1) : 0;
  data.signatures.forEach(([role, name, date], i) => {
    const x = left + i * (boxW + spacing);
    pdf.font(FONT).fontSize(10).text(role, x, blockTop, { width: boxW, align: "center" });
    pdf
      .font(name ? FONT_BOLD : FONT)
      .text(name ?? "(..............................)", x, blockTop + 70, {
        width: boxW,
        align: "center",
        underline: Boolean(name),
      });
    if (date) {
      pdf.font(FONT).fontSize(8).text(date, x, pdf.y + 2, { width: boxW, align: "center" });
      pdf.fontSize(10);
    }
  });

  pdf.end();
  return done;
}
