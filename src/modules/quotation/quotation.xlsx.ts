import ExcelJS from "exceljs";
import { sanitizeExcelText } from "../project/projectRabExport.planner";
import { splitLines, type QuotationDocument } from "./quotation.document";
import {
  fitBox,
  readLogoImageInfo,
  VERIFY_NOTE,
  type QuotationLogo,
  type QuotationVerifyMark,
} from "./quotation.logo";

const FONT = "Arial";
const RP_FORMAT = '"Rp" #,##0';
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};
const SECTION_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F2F2" },
};
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};
/** Logo box in pixels; ExcelJS rows default to ~20px at 15pt. */
const LOGO_MAX_W = 180;
const LOGO_MAX_H = 80;
const ROW_PX = 20;
/** Row height (pt) for one 10pt text line. */
const LINE_PT = 15;
/** No · Kode · Keterangan · Ukuran · Qty · Satuan · Harga/Unit · Total. */
const COL_COUNT = 8;
const DESC_COL = 3;
/** Letterhead text starts right of the logo. */
const LETTERHEAD_TEXT_COL = 4;

export function buildQuotationWorkbook(
  doc: QuotationDocument,
  logo: QuotationLogo | null,
  verify: QuotationVerifyMark | null = null,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Quotation", {
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  ws.columns = [
    { width: 6 },
    { width: 10 },
    { width: 50 },
    { width: 22 },
    { width: 8 },
    { width: 9 },
    { width: 18 },
    { width: 20 },
  ];
  const text = (v: string) => sanitizeExcelText(v);

  const put = (
    row: number,
    col: number,
    value: ExcelJS.CellValue,
    opts?: {
      bold?: boolean;
      italic?: boolean;
      size?: number;
      numFmt?: string;
      align?: "left" | "right" | "center";
      wrap?: boolean;
    },
  ) => {
    const cell = ws.getCell(row, col);
    cell.value = value;
    cell.font = {
      name: FONT,
      size: opts?.size ?? 10,
      bold: opts?.bold ?? false,
      italic: opts?.italic ?? false,
    };
    if (opts?.numFmt) cell.numFmt = opts.numFmt;
    if (opts?.align) {
      cell.alignment = {
        horizontal: opts.align,
        vertical: "middle",
        wrapText: opts.wrap ?? true,
      };
    }
    return cell;
  };
  const line = (row: number, value: string, from = 1, opts?: Parameters<typeof put>[3]) => {
    put(row, from, value, { align: "left", ...opts });
    ws.mergeCells(row, from, row, COL_COUNT);
  };

  // Letterhead: logo top-left with company text beside it, else text full width.
  const info = logo ? readLogoImageInfo(logo.buffer) : null;
  const textCol = info ? LETTERHEAD_TEXT_COL : 1;
  let r = 1;
  if (logo && info) {
    const size = fitBox(info.width, info.height, LOGO_MAX_W, LOGO_MAX_H);
    const imageId = wb.addImage({
      buffer: logo.buffer as unknown as ExcelJS.Buffer,
      extension: info.kind,
    });
    ws.addImage(imageId, {
      tl: { col: 0.1, row: 0.1 },
      ext: { width: size.width, height: size.height },
    });
  }
  line(r, text(doc.companyName), textCol, { bold: true, size: 14, wrap: false });
  ws.getRow(r).height = 20;
  r += 1;
  for (const l of doc.letterhead) {
    line(r, text(l), textCol, { wrap: false });
    ws.getRow(r).height = LINE_PT;
    r += 1;
  }
  if (info) {
    const logoRows = Math.ceil(LOGO_MAX_H / ROW_PX) + 1;
    r = Math.max(r, logoRows);
  }
  for (let c = 1; c <= COL_COUNT; c += 1) {
    ws.getCell(r, c).border = { bottom: { style: "medium" } };
  }

  r += 2;
  line(r, doc.title, 1, { bold: true, size: 13, align: "center" });
  r += 2;

  // Meta: recipient in A–C (label A–B, value C), document reference in D–H
  // (label D, value E–H), side by side.
  const metaRows = Math.max(doc.meta.left.length, doc.meta.right.length);
  for (let i = 0; i < metaRows; i += 1) {
    let lineCount = 1;
    const metaCell = (
      pair: [string, string] | undefined,
      labelFrom: number,
      labelTo: number,
      valueFrom: number,
      valueTo: number,
    ) => {
      if (!pair) return;
      const lines = splitLines(pair[1]);
      lineCount = Math.max(lineCount, lines.length);
      put(r, labelFrom, pair[0], { bold: true, align: "left" }).alignment = {
        vertical: "top",
      };
      if (labelTo > labelFrom) ws.mergeCells(r, labelFrom, r, labelTo);
      put(r, valueFrom, `: ${text(lines.join("\n"))}`).alignment = {
        vertical: "top",
        wrapText: true,
      };
      if (valueTo > valueFrom) ws.mergeCells(r, valueFrom, r, valueTo);
    };
    metaCell(doc.meta.left[i], 1, 2, 3, 3);
    metaCell(doc.meta.right[i], 4, 4, 5, COL_COUNT);
    if (lineCount > 1) ws.getRow(r).height = LINE_PT * lineCount;
    r += 1;
  }
  r += 1;

  doc.tableHeader.forEach((h, i) => {
    const cell = put(r, i + 1, h, { bold: true, align: "center" });
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
  });
  ws.getRow(r).height = LINE_PT * 2;
  r += 1;

  for (const row of doc.rows) {
    if (row.type !== "line") {
      const isSection = row.type === "section";
      const label = put(r, 1, text(isSection ? row.title : row.label), {
        bold: true,
        align: isSection ? "center" : "right",
      });
      ws.mergeCells(r, 1, r, isSection ? COL_COUNT : COL_COUNT - 1);
      label.fill = SECTION_FILL;
      label.border = THIN_BORDER;
      if (!isSection) {
        const amount = put(r, COL_COUNT, row.amount, {
          bold: true,
          numFmt: RP_FORMAT,
          align: "right",
        });
        amount.fill = SECTION_FILL;
        amount.border = THIN_BORDER;
      }
      r += 1;
      continue;
    }
    // Keterangan: the item name in bold, its spec lines below in one cell.
    const keterangan: ExcelJS.CellValue = {
      richText: [
        { text: text(row.description), font: { name: FONT, size: 10, bold: true } },
        ...row.descriptions.map((d) => ({
          text: `\n${text(d)}`,
          font: { name: FONT, size: 10 },
        })),
      ],
    };
    const values: ExcelJS.CellValue[] = [
      row.no,
      text(row.code),
      keterangan,
      text(row.dimension),
      row.qty,
      text(row.uom),
      row.unitPrice,
      row.amount,
    ];
    values.forEach((v, i) => {
      const col = i + 1;
      const money = col >= COL_COUNT - 1;
      const cell = put(r, col, v, {
        align: col === DESC_COL ? "left" : money ? "right" : "center",
        ...(money ? { numFmt: RP_FORMAT } : {}),
      });
      cell.alignment = { ...cell.alignment, vertical: "top" };
      cell.border = THIN_BORDER;
    });
    // Excel does not grow merged/wrapped rows itself: estimate wrapped lines.
    const descWidth = Number(ws.getColumn(DESC_COL).width ?? 50);
    const wrapped = [row.description, ...row.descriptions].reduce(
      (n, t) => n + Math.max(1, Math.ceil(t.length / descWidth)),
      0,
    );
    ws.getRow(r).height = LINE_PT * wrapped;
    r += 1;
  }

  for (const total of doc.totals) {
    put(r, COL_COUNT - 1, total.label, {
      bold: total.emphasis,
      align: "right",
    }).border = THIN_BORDER;
    put(r, COL_COUNT, total.amount, {
      bold: total.emphasis,
      numFmt: RP_FORMAT,
      align: "right",
    }).border = THIN_BORDER;
    r += 1;
  }
  line(r, doc.terbilang, 1, { italic: true });
  r += 2;

  if (doc.terms.length > 0 || doc.notes.length > 0) {
    put(r, 1, "Syarat & Ketentuan", { bold: true });
    r += 1;
    for (const t of [...doc.terms, ...doc.notes]) {
      line(r, text(t));
      r += 1;
    }
    r += 1;
  }

  if (verify) {
    // QR over columns A–B, link + note beside it in column C.
    const qrId = wb.addImage({
      buffer: verify.qrPng as unknown as ExcelJS.Buffer,
      extension: "png",
    });
    ws.addImage(qrId, {
      tl: { col: 0.05, row: r - 1 + 0.1 },
      ext: { width: 70, height: 70 },
    });
    put(r, 3, "Verify this quotation", { bold: true, size: 8, align: "left", wrap: false });
    const link = ws.getCell(r + 1, 3);
    link.value = { text: verify.url, hyperlink: verify.url };
    link.font = { name: FONT, size: 7, color: { argb: "FF1D4ED8" }, underline: true };
    put(r + 2, 3, VERIFY_NOTE, { size: 7, align: "left" });
    ws.getRow(r + 2).height = 22;
  }
  const signFrom = COL_COUNT - 1;
  put(r, signFrom, doc.signOff, { align: "center" });
  ws.mergeCells(r, signFrom, r, COL_COUNT);
  put(r + 1, signFrom, text(doc.companyName), { bold: true, align: "center" });
  ws.mergeCells(r + 1, signFrom, r + 1, COL_COUNT);
  r += 5;
  const signer = put(
    r,
    signFrom,
    text(doc.signerName ?? "(....................................)"),
    { bold: Boolean(doc.signerName), align: "center" },
  );
  if (doc.signerName) signer.font = { ...signer.font, underline: true };
  ws.mergeCells(r, signFrom, r, COL_COUNT);

  return wb;
}
