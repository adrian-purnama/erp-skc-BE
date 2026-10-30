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

/** Everything printed on an SPK; built by the service, rendered here. */
export type SpkPdfData = {
  companyName: string;
  letterhead: string[];
  /** "SURAT PERINTAH KERJA PRODUKSI" (+ " (DRAFT)"). */
  title: string;
  meta: { left: Array<[string, string]>; right: Array<[string, string]> };
  item: {
    code: string;
    name: string;
    descriptions: string[];
    dimension: string;
    qty: string;
  };
  schedule: Array<[string, string]>;
  /** Label, text, and an app link that downloads the file (null = no file). */
  files: Array<{ label: string; text: string; url: string | null }>;
  materials: Array<{
    code: string;
    name: string;
    perUnit: string;
    total: string;
    uom: string;
  }>;
  notes: string[];
  /** Place + date line above the signatures, e.g. "Jakarta, 28 Oktober 2026". */
  signDate: string;
  issuerName: string | null;
  picName: string | null;
};

/** No · Kode · Material · Per unit · Total · Satuan — sums to A4 content width. */
const MAT_COLS = [24, 95, 200, 70, 70, 56] as const;
const MAT_ALIGN: Array<"left" | "center" | "right"> = [
  "center",
  "left",
  "left",
  "right",
  "right",
  "center",
];
/** Kode · Item · Ukuran · Qty. */
const ITEM_COLS = [70, 285, 100, 60] as const;
const ITEM_ALIGN: Array<"left" | "center" | "right"> = [
  "left",
  "left",
  "center",
  "center",
];

type Cell = string | { title: string; lines: string[] };

/** Logo + company name and address, a rule, then the centred title; leaves pdf.y below it. */
export function drawLetterhead(
  pdf: PDFKit.PDFDocument,
  data: { companyName: string; letterhead: string[]; title: string },
  logo: QuotationLogo | null,
): void {
  const left = MARGIN;
  const width = pdf.page.width - MARGIN * 2;
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
  pdf.font(FONT_BOLD).fontSize(14).text(data.companyName, textLeft, top, {
    width: textWidth,
  });
  pdf.font(FONT).fontSize(9);
  for (const line of data.letterhead) {
    pdf.text(line, textLeft, pdf.y + 1, { width: textWidth });
  }
  const headBottom = Math.max(pdf.y, info ? top + LOGO_MAX_H : top) + 8;
  pdf
    .moveTo(left, headBottom)
    .lineTo(left + width, headBottom)
    .lineWidth(1.2)
    .strokeColor(LINE_COLOR)
    .stroke();

  pdf.font(FONT_BOLD).fontSize(13).text(data.title, left, headBottom + 16, {
    width,
    align: "center",
  });
  pdf.moveDown(1);
}

export function buildSpkPdf(
  data: SpkPdfData,
  logo: QuotationLogo | null,
): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: { Title: data.meta.right.find(([k]) => k === "No. SPK")?.[1] ?? "SPK" },
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

  drawLetterhead(pdf, data, logo);

  // Meta: project left, SPK reference right.
  pdf.fontSize(10);
  const labelW = 70;
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

  const table = <N extends number>(
    cols: readonly number[] & { length: N },
    aligns: Array<"left" | "center" | "right">,
  ) => {
    const cellHeight = (c: Cell, i: number, bold: boolean) => {
      const w = cols[i]! - CELL_PAD * 2;
      if (typeof c === "string") {
        return pdf.font(bold ? FONT_BOLD : FONT).fontSize(9).heightOfString(c || " ", { width: w });
      }
      const title = pdf.font(FONT_BOLD).fontSize(9).heightOfString(c.title, { width: w });
      const lines =
        c.lines.length > 0
          ? pdf.font(FONT).fontSize(9).heightOfString(c.lines.join("\n"), { width: w })
          : 0;
      return title + lines;
    };
    return (cells: Cell[], opts: { bold?: boolean; fill?: string; center?: boolean } = {}) => {
      const h =
        Math.max(...cells.map((c, i) => cellHeight(c, i, opts.bold === true))) +
        CELL_PAD * 2;
      ensure(h);
      const y = pdf.y;
      let x = left;
      cells.forEach((c, i) => {
        const w = cols[i]!;
        if (opts.fill) pdf.rect(x, y, w, h).fill(opts.fill).fillColor("#000000");
        pdf.rect(x, y, w, h).lineWidth(0.5).strokeColor(LINE_COLOR).stroke();
        const align = opts.center ? "center" : aligns[i];
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
    };
  };

  const heading = (text: string) => {
    ensure(40);
    pdf.font(FONT_BOLD).fontSize(10).text(text, left, pdf.y, { width });
    pdf.moveDown(0.3);
  };

  const pairs = (rows: Array<[string, string]>) => {
    pdf.fontSize(9);
    for (const [label, value] of rows) {
      ensure(14);
      const y = pdf.y;
      pdf.font(FONT_BOLD).text(label, left, y, { width: 100 });
      pdf.font(FONT).text(`: ${value}`, left + 100, y, { width: width - 100 });
      pdf.y = Math.max(pdf.y, y) + 2;
    }
  };

  // Item to make
  heading("Item yang dikerjakan");
  const itemRow = table(ITEM_COLS, ITEM_ALIGN);
  itemRow(["Kode", "Item", "Ukuran", "Qty"], { bold: true, fill: HEADER_FILL, center: true });
  itemRow([
    data.item.code || "-",
    { title: data.item.name, lines: data.item.descriptions },
    data.item.dimension || "-",
    data.item.qty,
  ]);
  pdf.moveDown(0.8);

  heading("Jadwal & penanggung jawab");
  pairs(data.schedule);
  pdf.moveDown(0.6);

  heading("File");
  pdf.fontSize(9);
  for (const f of data.files) {
    ensure(14);
    const y = pdf.y;
    pdf.font(FONT_BOLD).fillColor("#000000").text(f.label, left, y, { width: 100 });
    pdf.font(FONT).text(": ", left + 100, y, { continued: true });
    if (f.url) {
      pdf
        .fillColor("#1d4ed8")
        .text(f.text, { link: f.url, underline: true, width: width - 110 })
        .fillColor("#000000");
    } else {
      pdf.text(f.text, { width: width - 110 });
    }
    pdf.y = Math.max(pdf.y, y) + 2;
  }
  if (data.files.some((f) => f.url)) {
    pdf
      .font(FONT)
      .fontSize(7)
      .fillColor("#555555")
      .text("Klik nama file untuk mengunduh (perlu login ke aplikasi).", left, pdf.y + 1, {
        width,
      })
      .fillColor("#000000");
  }
  pdf.moveDown(0.6);

  heading("Kebutuhan material");
  const matRow = table(MAT_COLS, MAT_ALIGN);
  const matHeader = () =>
    matRow(["No", "Kode", "Material", "Per unit", "Total", "Satuan"], {
      bold: true,
      fill: HEADER_FILL,
      center: true,
    });
  matHeader();
  if (data.materials.length === 0) {
    matRow(["", "", "Tidak ada material di BOQ", "", "", ""]);
  }
  data.materials.forEach((m, i) => {
    if (pdf.y + 20 > bottom()) {
      pdf.addPage();
      matHeader();
    }
    matRow([String(i + 1), m.code, m.name, m.perUnit, m.total, m.uom]);
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

  // Signatures: issuer left, PIC right.
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
  signature(left, "Dikeluarkan oleh,", data.issuerName);
  signature(left + width - boxW, "Diterima oleh (PIC),", data.picName);

  pdf.end();
  return done;
}
