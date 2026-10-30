import PDFDocument from "pdfkit";
import type { QuotationLogo } from "../quotation/quotation.logo";
import { drawLetterhead } from "./production.pdf";

const MARGIN = 40;
const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const CELL_PAD = 4;
const HEADER_FILL = "#D9D9D9";
const LINE_COLOR = "#000000";

/** Everything printed on a Berita Acara Serah Terima; built by the service, rendered here. */
export type HandoverPdfData = {
  companyName: string;
  letterhead: string[];
  /** "BERITA ACARA SERAH TERIMA" (+ " (DRAFT)" / " (DIBATALKAN)"). */
  title: string;
  meta: { left: Array<[string, string]>; right: Array<[string, string]> };
  item: { code: string; name: string; dimension: string; qty: string; spkQty: string };
  checklist: Array<{ label: string; result: string; note: string }>;
  notes: string[];
  signDate: string;
  vendorName: string | null;
  receiverName: string | null;
};

/** Kode · Item · Ukuran · Diterima · Qty SPK — sums to A4 content width. */
const ITEM_COLS = [70, 225, 100, 60, 60] as const;
/** No · Pemeriksaan · Hasil · Catatan. */
const CHECK_COLS = [24, 200, 60, 231] as const;

export function buildHandoverPdf(
  data: HandoverPdfData,
  logo: QuotationLogo | null,
): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: { Title: data.meta.right.find(([k]) => k === "No. BAST")?.[1] ?? "BAST" },
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
  pdf.y = Math.max(
    metaColumn(data.meta.left, left),
    metaColumn(data.meta.right, left + halfW + gap),
  );
  pdf.moveDown(0.8);

  const row = (
    cols: readonly number[],
    cells: string[],
    opts: { bold?: boolean; fill?: string; align?: Array<"left" | "center" | "right"> } = {},
  ) => {
    const font = opts.bold ? FONT_BOLD : FONT;
    const h =
      Math.max(
        ...cells.map((c, i) =>
          pdf.font(font).fontSize(9).heightOfString(c || " ", { width: cols[i]! - CELL_PAD * 2 }),
        ),
      ) +
      CELL_PAD * 2;
    ensure(h);
    const y = pdf.y;
    let x = left;
    cells.forEach((c, i) => {
      const w = cols[i]!;
      if (opts.fill) pdf.rect(x, y, w, h).fill(opts.fill).fillColor("#000000");
      pdf.rect(x, y, w, h).lineWidth(0.5).strokeColor(LINE_COLOR).stroke();
      pdf.font(font).fontSize(9).text(c, x + CELL_PAD, y + CELL_PAD, {
        width: w - CELL_PAD * 2,
        align: opts.align?.[i] ?? "left",
      });
      x += w;
    });
    pdf.y = y + h;
  };
  const heading = (text: string) => {
    ensure(40);
    pdf.font(FONT_BOLD).fontSize(10).text(text, left, pdf.y, { width });
    pdf.moveDown(0.3);
  };
  const center = ["center", "center", "center", "center", "center"] as const;

  heading("Item yang diserahkan");
  row(ITEM_COLS, ["Kode", "Item", "Ukuran", "Diterima", "Qty SPK"], {
    bold: true,
    fill: HEADER_FILL,
    align: [...center],
  });
  row(
    ITEM_COLS,
    [data.item.code || "-", data.item.name, data.item.dimension || "-", data.item.qty, data.item.spkQty],
    { align: ["left", "left", "center", "center", "center"] },
  );
  pdf.moveDown(0.8);

  heading("Pemeriksaan");
  row(CHECK_COLS, ["No", "Pemeriksaan", "Hasil", "Catatan"], {
    bold: true,
    fill: HEADER_FILL,
    align: [...center],
  });
  data.checklist.forEach((c, i) => {
    row(CHECK_COLS, [String(i + 1), c.label, c.result, c.note], {
      align: ["center", "left", "center", "left"],
    });
  });

  if (data.notes.length > 0) {
    pdf.moveDown(0.8);
    heading("Catatan");
    pdf.font(FONT).fontSize(9);
    data.notes.forEach((line, i) => {
      ensure(14);
      const y = pdf.y + 1;
      pdf.text(`${i + 1}.`, left, y, { width: 16, align: "right" });
      pdf.text(line, left + 22, y, { width: width - 22 });
    });
  }

  // Signatures: vendor hands over (left), we receive (right).
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
  signature(left, "Diserahkan oleh (Vendor),", data.vendorName);
  signature(left + width - boxW, "Diterima oleh,", data.receiverName);

  pdf.end();
  return done;
}
