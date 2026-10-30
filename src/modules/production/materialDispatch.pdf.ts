import PDFDocument from "pdfkit";
import type { QuotationLogo } from "../quotation/quotation.logo";
import { drawLetterhead } from "./production.pdf";

const MARGIN = 40;
const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const CELL_PAD = 4;
const HEADER_FILL = "#D9D9D9";
const LINE_COLOR = "#000000";

/** Everything printed on a Surat Jalan to a subcon vendor; built by the service, rendered here. */
export type DispatchPdfData = {
  companyName: string;
  letterhead: string[];
  title: string;
  meta: { left: Array<[string, string]>; right: Array<[string, string]> };
  /** The shop drawing item the material is for. */
  item: string;
  lines: Array<{ code: string; name: string; qty: string; uom: string }>;
  notes: string[];
  signDate: string;
  senderName: string | null;
  receiverName: string | null;
};

/** No · Kode · Material · Qty · Satuan — sums to A4 content width. */
const COLS = [28, 100, 257, 70, 60] as const;
const ALIGN: Array<"left" | "center" | "right"> = ["center", "left", "left", "right", "center"];

export function buildDispatchPdf(data: DispatchPdfData, logo: QuotationLogo | null): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: { Title: data.meta.right.find(([k]) => k === "No. SJ")?.[1] ?? "Surat Jalan" },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  const left = MARGIN;
  const width = pdf.page.width - MARGIN * 2;
  const ensure = (h: number) => {
    if (pdf.y + h > pdf.page.height - MARGIN) pdf.addPage();
  };

  drawLetterhead(pdf, data, logo);

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

  pdf.font(FONT_BOLD).fontSize(10).text(`Material untuk: ${data.item}`, left, pdf.y, { width });
  pdf.moveDown(0.3);

  const row = (cells: string[], opts: { bold?: boolean; fill?: string } = {}) => {
    const font = opts.bold ? FONT_BOLD : FONT;
    const h =
      Math.max(
        ...cells.map((c, i) =>
          pdf.font(font).fontSize(9).heightOfString(c || " ", { width: COLS[i]! - CELL_PAD * 2 }),
        ),
      ) +
      CELL_PAD * 2;
    ensure(h);
    const y = pdf.y;
    let x = left;
    cells.forEach((c, i) => {
      const w = COLS[i]!;
      if (opts.fill) pdf.rect(x, y, w, h).fill(opts.fill).fillColor("#000000");
      pdf.rect(x, y, w, h).lineWidth(0.5).strokeColor(LINE_COLOR).stroke();
      pdf.font(font).fontSize(9).text(c, x + CELL_PAD, y + CELL_PAD, {
        width: w - CELL_PAD * 2,
        align: opts.bold ? "center" : ALIGN[i],
      });
      x += w;
    });
    pdf.y = y + h;
  };

  const header = () => row(["No", "Kode", "Material", "Qty", "Satuan"], { bold: true, fill: HEADER_FILL });
  header();
  data.lines.forEach((l, i) => {
    if (pdf.y + 20 > pdf.page.height - MARGIN) {
      pdf.addPage();
      header();
    }
    row([String(i + 1), l.code, l.name, l.qty, l.uom]);
  });

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

  // Signatures: we send (left), the vendor receives (right).
  pdf.moveDown(2);
  ensure(110);
  pdf.font(FONT).fontSize(10).text(data.signDate, left, pdf.y, { width, align: "right" });
  pdf.moveDown(0.5);
  const blockTop = pdf.y;
  const boxW = 180;
  const signature = (x: number, role: string, name: string | null) => {
    pdf.font(FONT).fontSize(10).text(role, x, blockTop, { width: boxW, align: "center" });
    pdf
      .font(name ? FONT_BOLD : FONT)
      .text(name ?? "(....................................)", x, blockTop + 70, {
        width: boxW,
        align: "center",
        underline: Boolean(name),
      });
  };
  signature(left, "Dikirim oleh,", data.senderName);
  signature(left + width - boxW, "Diterima oleh (Vendor),", data.receiverName);

  pdf.end();
  return done;
}
