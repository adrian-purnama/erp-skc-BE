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
    { width: 10 },
    { width: 44 },
    { width: 10 },
    { width: 10 },
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
    ws.mergeCells(row, from, row, 6);
  };

  // Letterhead: logo top-left with company text beside it, else text full width.
  const info = logo ? readLogoImageInfo(logo.buffer) : null;
  const textCol = info ? 3 : 1;
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
  for (let c = 1; c <= 6; c += 1) {
    ws.getCell(r, c).border = { bottom: { style: "medium" } };
  }

  r += 2;
  line(r, doc.title, 1, { bold: true, size: 13, align: "center" });
  r += 2;

  for (const [label, value] of doc.meta) {
    const lines = splitLines(value);
    put(r, 1, label, { bold: true, align: "left" }).alignment = {
      vertical: "top",
    };
    line(r, text(lines.join("\n")), 2);
    ws.getCell(r, 2).alignment = { vertical: "top", wrapText: true };
    if (lines.length > 1) ws.getRow(r).height = LINE_PT * lines.length;
    r += 1;
  }
  r += 1;

  doc.tableHeader.forEach((h, i) => {
    const cell = put(r, i + 1, h, { bold: true, align: "center" });
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
  });
  r += 1;

  for (const row of doc.rows) {
    if (row.type !== "line") {
      const isSection = row.type === "section";
      const label = put(r, 1, text(isSection ? row.title : row.label), {
        bold: true,
        align: isSection ? "center" : "right",
      });
      ws.mergeCells(r, 1, r, isSection ? 6 : 5);
      label.fill = SECTION_FILL;
      label.border = THIN_BORDER;
      if (!isSection) {
        const amount = put(r, 6, row.amount, {
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
    const values: ExcelJS.CellValue[] = [
      row.no,
      text(row.description),
      row.qty,
      text(row.uom),
      row.unitPrice,
      row.amount,
    ];
    values.forEach((v, i) => {
      const cell = put(r, i + 1, v, {
        align: i === 1 ? "left" : i >= 4 ? "right" : "center",
        ...(i >= 4 ? { numFmt: RP_FORMAT } : {}),
      });
      cell.border = THIN_BORDER;
    });
    r += 1;
  }

  for (const total of doc.totals) {
    put(r, 5, total.label, { bold: total.emphasis, align: "right" }).border = THIN_BORDER;
    put(r, 6, total.amount, {
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
    // QR in column A, link + note beside it in column B.
    const qrId = wb.addImage({
      buffer: verify.qrPng as unknown as ExcelJS.Buffer,
      extension: "png",
    });
    ws.addImage(qrId, {
      tl: { col: 0.05, row: r - 1 + 0.1 },
      ext: { width: 70, height: 70 },
    });
    put(r, 2, "Verify this quotation", { bold: true, size: 8, align: "left", wrap: false });
    const link = ws.getCell(r + 1, 2);
    link.value = { text: verify.url, hyperlink: verify.url };
    link.font = { name: FONT, size: 7, color: { argb: "FF1D4ED8" }, underline: true };
    put(r + 2, 2, VERIFY_NOTE, { size: 7, align: "left" });
    ws.getRow(r + 2).height = 22;
  }
  put(r, 5, doc.signOff, { align: "center" });
  ws.mergeCells(r, 5, r, 6);
  put(r + 1, 5, text(doc.companyName), { bold: true, align: "center" });
  ws.mergeCells(r + 1, 5, r + 1, 6);
  r += 5;
  const signer = put(
    r,
    5,
    text(doc.signerName ?? "(....................................)"),
    { bold: Boolean(doc.signerName), align: "center" },
  );
  if (doc.signerName) signer.font = { ...signer.font, underline: true };
  ws.mergeCells(r, 5, r, 6);

  return wb;
}
