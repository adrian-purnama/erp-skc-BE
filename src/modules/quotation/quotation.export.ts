import QRCode from "qrcode";
import type { ProjectQuotationOutDto } from "../../dto/projectQuotation.dto";
import {
  formatExportYmd,
  safeFilenamePart,
} from "../project/projectRabExport.planner";
import { buildQuotationDocument } from "./quotation.document";
import type { QuotationLogo, QuotationVerifyMark } from "./quotation.logo";
import { buildQuotationPdf } from "./quotation.pdf";
import { quotationService } from "./quotation.service";
import { buildQuotationWorkbook } from "./quotation.xlsx";

export type QuotationExportFormat = "xlsx" | "pdf";

export type QuotationExportResult = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

async function verifyMark(
  q: ProjectQuotationOutDto,
): Promise<QuotationVerifyMark | null> {
  if (!q.verifyUrl || q.status === "draft") return null;
  const qrPng = await QRCode.toBuffer(q.verifyUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 360,
  });
  return { url: q.verifyUrl, qrPng };
}

async function render(
  q: ProjectQuotationOutDto,
  logo: QuotationLogo | null,
  format: QuotationExportFormat,
): Promise<QuotationExportResult> {
  const doc = buildQuotationDocument(q);
  const verify = await verifyMark(q);
  const base = [
    "Quotation",
    safeFilenamePart(q.quotationNumber),
    q.status === "draft" ? "DRAFT" : null,
    formatExportYmd(),
  ]
    .filter(Boolean)
    .join("_");

  if (format === "pdf") {
    return {
      buffer: await buildQuotationPdf(doc, logo, verify),
      filename: `${base}.pdf`,
      contentType: "application/pdf",
    };
  }

  const wb = buildQuotationWorkbook(doc, logo, verify);
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    filename: `${base}.xlsx`,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

export class QuotationExportService {
  async export(
    id: string,
    format: QuotationExportFormat,
  ): Promise<QuotationExportResult> {
    const raw = await quotationService.findById(id);
    if (!raw) throw new Error("Quotation not found");
    const q = await quotationService.getById(id);
    if (!q) throw new Error("Quotation not found");
    return render(q, await quotationService.loadLogo(raw), format);
  }

  /** Official PDF for the client link — only while the quotation may be shown. */
  async exportPublicPdf(token: string): Promise<QuotationExportResult> {
    const doc = await quotationService.requireValidByToken(token);
    const q = await quotationService.getById(String(doc._id));
    if (!q) throw new Error("Quotation not found");
    return render(q, await quotationService.loadLogo(doc), "pdf");
  }
}

export const quotationExportService = new QuotationExportService();
