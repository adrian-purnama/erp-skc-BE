import QRCode from "qrcode";
import type { Types } from "mongoose";
import { env } from "../../core/env";
import { readFileBuffer } from "../../core/gridfs";
import { PurchasePaymentRepo } from "../../models/purchasePayment.model";
import { PurchaseRealizationRepo } from "../../models/purchaseRealization.model";
import { VendorInvoiceRepo } from "../../models/vendorInvoice.model";
import { companyLetterhead, loadCompanyLogo } from "../appConfig";
import {
  formatExportYmd,
  formatLongDate,
  safeFilenamePart,
  splitLines,
  ymdLong,
} from "../../utils/document/text";
import { PURCHASING_BUCKET } from "./purchaseOrder.service";
import { purchasePaymentService } from "./purchasePayment.service";
import { purchaseRealizationService } from "./purchaseRealization.service";
import { buildPurchasingDocPdf, type PurchasingDocPdfData } from "./purchasingDoc.pdf";
import { vendorInvoiceService } from "./vendorInvoice.service";

type PdfFile = { buffer: Buffer; filename: string; contentType: string };
type StoredFile = { gridFsId: Types.ObjectId; originalFilename: string; contentType: string };

const PRINTABLE = /^image\/(jpeg|png)$/;

function rupiah(digits: string): string {
  return `Rp ${new Intl.NumberFormat("id-ID").format(Number(digits))}`;
}

function qty(value: string): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 }).format(Number(value));
}

function statusSuffix(status: string): string {
  return status === "draft" ? " (DRAFT)" : status === "voided" ? " (DIBATALKAN)" : "";
}

async function pageLink(path: string, caption: string): Promise<PurchasingDocPdfData["link"]> {
  const url = `${env.frontendUrl.replace(/\/+$/, "")}${path}`;
  const qrPng = await QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 360 });
  return { url, qrPng, caption };
}

/** JPEG / PNG files become pages; the rest are listed by name. */
async function attachments(files: StoredFile[]) {
  const images: PurchasingDocPdfData["images"] = [];
  const otherFiles: string[] = [];
  for (const f of files) {
    if (PRINTABLE.test(f.contentType)) {
      try {
        images.push({ name: f.originalFilename, buffer: await readFileBuffer(PURCHASING_BUCKET, f.gridFsId) });
        continue;
      } catch {
        // Missing in storage: list it instead.
      }
    }
    otherFiles.push(f.originalFilename);
  }
  return { images, otherFiles };
}

function filename(prefix: string, number: string, status: string): string {
  return `${[prefix, safeFilenamePart(number), status === "draft" ? "DRAFT" : null, formatExportYmd()]
    .filter(Boolean)
    .join("_")}.pdf`;
}

/**
 * GR as Tanda Terima Barang (goods only, with its invoice status), or NR as
 * Nota Realisasi (with the staff's prices). QR to the page; photos appended.
 */
export async function exportRealizationPdf(id: string): Promise<PdfFile> {
  const r = await purchaseRealizationService.get(id);
  const raw = await PurchaseRealizationRepo.model.findById(id).select({ photos: 1 }).lean().exec();
  const vendor = r.method === "vendor";
  const { companyName, letterhead } = companyLetterhead();
  const date = ymdLong(r.purchaseDate);
  const files = await attachments(raw?.photos ?? []);
  const data: PurchasingDocPdfData = {
    companyName,
    letterhead,
    title: `${vendor ? "TANDA TERIMA BARANG" : "NOTA REALISASI"}${statusSuffix(r.status)}`,
    subtitle: vendor
      ? r.invoice
        ? `Ditagih pada ${r.invoice.number}`
        : "Belum ada tagihan vendor (dinilai dengan harga PO)"
      : null,
    number: r.number,
    meta: {
      left: vendor
        ? [
            ["Vendor", r.vendorName],
            ["No. PO", r.poNumber],
            ["Proyek", `${r.projectNumber} · ${r.projectName}`],
            ["Dikirim ke", r.deliveredTo === "vendor" ? "Langsung ke vendor subcon" : "Kami"],
          ]
        : [
            ["Dibeli oleh", r.buyerName || "-"],
            ["Tempat beli", r.place || "-"],
            ["No. PO", r.poNumber],
            ["Proyek", `${r.projectNumber} · ${r.projectName}`],
          ],
      right: [
        ["No.", r.number],
        ["Tanggal", date],
        vendor ? ["Surat jalan", r.deliveryNoteNumber || "-"] : ["No. nota", r.notaNumber || "-"],
        ["Diterima oleh", r.receivedByName || "-"],
      ],
    },
    table: vendor
      ? {
          head: ["No", "Kode", "Material", "Qty", "Satuan", "Catatan"],
          cols: [24, 70, 201, 60, 50, 110],
          align: ["center", "left", "left", "right", "center", "left"],
          rows: r.lines.map((l, i) => [String(i + 1), l.materialCode, l.materialName, qty(l.qty), l.uomSymbol, l.note]),
        }
      : {
          head: ["No", "Kode", "Material", "Qty", "Satuan", "Harga", "Jumlah"],
          cols: [24, 64, 177, 50, 40, 75, 85],
          align: ["center", "left", "left", "right", "center", "right", "right"],
          rows: r.lines.map((l, i) => [
            String(i + 1),
            l.materialCode,
            l.materialName,
            qty(l.qty),
            l.uomSymbol,
            rupiah(l.unitPrice),
            rupiah(l.amount),
          ]),
        },
    totals: vendor
      ? []
      : [
          ["Subtotal", rupiah(r.subtotal), false],
          ...r.charges.map((c): [string, string, boolean] => [
            c.kind === "percent" ? `${c.label} (${c.rate}%)` : c.label,
            rupiah(c.amount),
            false,
          ]),
          ["Total", rupiah(r.total), true],
        ],
    remarks: [],
    notes: splitLines(r.comments),
    link: await pageLink(
      `/dashboard/purchasing/realizations/${r.id}`,
      "Pindai QR untuk membuka dokumen ini di aplikasi (perlu login).",
    ),
    signDate: date,
    signatures: vendor
      ? [
          ["Diserahkan oleh (vendor / sopir),", null],
          ["Diterima oleh,", r.receivedByName || null],
        ]
      : [
          ["Dibeli oleh,", r.buyerName || null],
          ["Diperiksa oleh,", null],
        ],
    ...files,
  };
  return {
    buffer: await buildPurchasingDocPdf(data, await loadCompanyLogo()),
    filename: filename(vendor ? "GR" : "NR", r.number, r.status),
    contentType: "application/pdf",
  };
}

/** Vendor invoice as Tanda Terima Tagihan, with the PO's payment status in small print. */
export async function exportVendorInvoicePdf(id: string): Promise<PdfFile> {
  const inv = await vendorInvoiceService.get(id);
  const raw = await VendorInvoiceRepo.model.findById(id).select({ files: 1 }).lean().exec();
  const payments = await purchasePaymentService.forOrder(inv.purchaseOrderId);
  const vendorPay = payments.payees.find((p) => p.kind === "vendor");
  const { companyName, letterhead } = companyLetterhead();
  const received = inv.postedAt ? formatLongDate(new Date(inv.postedAt)) : ymdLong(inv.invoiceDate);
  const files = await attachments(raw?.files ?? []);
  const data: PurchasingDocPdfData = {
    companyName,
    letterhead,
    title: `TANDA TERIMA TAGIHAN${statusSuffix(inv.status)}`,
    subtitle: null,
    number: inv.number,
    meta: {
      left: [
        ["Vendor", inv.vendorName],
        ["No. tagihan", inv.vendorInvoiceNumber || "-"],
        ["Tgl. tagihan", ymdLong(inv.invoiceDate)],
        ["No. PO", inv.poNumber],
      ],
      right: [
        ["No.", inv.number],
        ["Diterima", received],
        ["Jatuh tempo", ymdLong(inv.dueDate)],
        ["Surat jalan", inv.receipts.map((g) => g.deliveryNoteNumber || g.number).join(", ") || "-"],
      ],
    },
    table: {
      head: ["No", "GR", "Material", "Qty", "Satuan", "Harga", "Jumlah"],
      cols: [24, 92, 149, 50, 40, 75, 85],
      align: ["center", "left", "left", "right", "center", "right", "right"],
      rows: inv.lines.map((l, i) => [
        String(i + 1),
        l.realizationNumber,
        l.materialName,
        qty(l.qty),
        l.uomSymbol,
        rupiah(l.unitPrice),
        rupiah(l.amount),
      ]),
    },
    totals: [
      ["Subtotal", rupiah(inv.subtotal), false],
      ...inv.charges.map((c): [string, string, boolean] => [
        c.kind === "percent" ? `${c.label} (${c.rate}%)` : c.label,
        rupiah(c.amount),
        false,
      ]),
      ["Total tagihan", rupiah(inv.total), true],
    ],
    remarks: vendorPay
      ? [
          `Status pembayaran ${inv.poNumber}: dibayar ${rupiah(vendorPay.paidTotal)} dari ${rupiah(vendorPay.owed)} terutang; sisa belum dijadwalkan ${rupiah(vendorPay.remaining)}.`,
        ]
      : [],
    notes: splitLines(inv.notes),
    link: await pageLink(
      `/dashboard/purchasing/invoices/${inv.id}`,
      "Pindai QR untuk membuka tagihan ini di aplikasi (perlu login).",
    ),
    signDate: received,
    signatures: [
      ["Diserahkan oleh (vendor),", null],
      ["Diterima oleh,", inv.createdBy?.name ?? null],
    ],
    ...files,
  };
  return {
    buffer: await buildPurchasingDocPdf(data, await loadCompanyLogo()),
    filename: filename("TTT", inv.number, inv.status),
    contentType: "application/pdf",
  };
}

const PAYMENT_METHOD_ID: Record<string, string> = { transfer: "Transfer bank", cash: "Tunai", other: "Lainnya" };

function paymentSuffix(status: string): string {
  switch (status) {
    case "draft":
      return " (DRAFT)";
    case "cancelled":
      return " (DIBATALKAN)";
    case "rejected":
      return " (DITOLAK)";
    case "paid":
      return "";
    default:
      return " (BELUM DIBAYAR)";
  }
}

/**
 * Payment as Bukti Pembayaran (vendor payment or reimbursement): what it pays
 * (invoices with their GRs, or NR), the approvals, and the transfer slip as
 * extra pages. QR to the payment.
 */
export async function exportPaymentPdf(id: string): Promise<PdfFile> {
  const p = await purchasePaymentService.get(id);
  const raw = await PurchasePaymentRepo.model.findById(id).select({ proofs: 1, invoiceIds: 1 }).lean().exec();
  const invoices = (await VendorInvoiceRepo.model
    .find({ _id: { $in: raw?.invoiceIds ?? [] } })
    .select({ number: 1, vendorInvoiceNumber: 1, realizationIds: 1, total: 1 })
    .lean()
    .exec()) as Array<{ _id: Types.ObjectId; number: string; vendorInvoiceNumber: string; realizationIds: Types.ObjectId[]; total: string }>;
  const grs = await PurchaseRealizationRepo.model
    .find({ _id: { $in: invoices.flatMap((i) => i.realizationIds) } })
    .select({ number: 1, deliveryNoteNumber: 1 })
    .lean()
    .exec();
  const grLabel = new Map(
    grs.map((g) => [String(g._id), g.deliveryNoteNumber ? `${g.number} (SJ ${g.deliveryNoteNumber})` : g.number]),
  );
  const vendor = p.kind === "vendor";
  const { companyName, letterhead } = companyLetterhead();
  const files = await attachments(raw?.proofs ?? []);
  const on = (at: string | null) => (at ? formatLongDate(new Date(at)) : "-");
  const stage = p.stage === "full" ? "Pelunasan / penuh" : p.basis === "percent" && p.rate ? `Sebagian ${p.rate}%` : "Sebagian";
  const rows: string[][] = vendor
    ? invoices.map((inv, i) => [
        String(i + 1),
        inv.number,
        inv.vendorInvoiceNumber || "-",
        inv.realizationIds.map((rid) => grLabel.get(String(rid)) ?? "-").join(", "),
        rupiah(inv.total),
      ])
    : p.realizations.map((r, i) => [String(i + 1), r.number, ymdLong(r.purchaseDate), "-", rupiah(r.total)]);
  const data: PurchasingDocPdfData = {
    companyName,
    letterhead,
    title: `BUKTI PEMBAYARAN${paymentSuffix(p.status)}`,
    subtitle: vendor ? "Pembayaran ke vendor" : "Penggantian (reimbursement) ke staf",
    number: p.number,
    meta: {
      left: [
        ["Dibayar ke", p.payeeName || "-"],
        ["No. PO", p.purchaseOrderNumber],
        ["Jenis", stage],
        ["Jatuh tempo", ymdLong(p.dueDate)],
      ],
      right: [
        ["No.", p.number],
        ["Tgl. bayar", p.paidDate ? ymdLong(p.paidDate) : "-"],
        ["Metode", p.method ? PAYMENT_METHOD_ID[p.method] ?? p.method : "-"],
        ["Referensi", p.reference || "-"],
      ],
    },
    table: {
      head: vendor
        ? ["No", "Tagihan", "No. tagihan vendor", "Penerimaan (GR)", "Total tagihan"]
        : ["No", "Nota Realisasi", "Tanggal", "", "Total nota"],
      cols: [24, 110, 110, 176, 95],
      align: ["center", "left", "left", "left", "right"],
      rows: rows.length > 0 ? rows : [["-", vendor ? "Tidak merujuk tagihan (mis. DP)" : "Tidak merujuk nota", "", "", ""]],
    },
    totals: [["Jumlah dibayar", rupiah(p.amount), true]],
    remarks: [
      `Diajukan oleh ${p.createdBy?.name ?? "-"} · Disetujui L1: ${p.approved1By?.name ?? "-"} (${on(p.approved1At)}) · L2: ${p.approvedBy?.name ?? "-"} (${on(p.approvedAt)})`,
      ...(p.status === "cancelled" ? [`Dibatalkan: ${p.cancelReason}`] : []),
      ...(p.status === "rejected" ? [`Ditolak: ${p.rejectReason}`] : []),
    ],
    notes: splitLines(p.notes),
    link: await pageLink(
      `/dashboard/finance/payments?payment=${p.id}`,
      "Pindai QR untuk membuka pembayaran ini di aplikasi (perlu login).",
    ),
    signDate: p.paidDate ? ymdLong(p.paidDate) : formatLongDate(new Date()),
    signatures: [
      ["Dibuat oleh,", p.createdBy?.name ?? null],
      ["Disetujui oleh,", p.approvedBy?.name ?? null],
      ["Diterima oleh,", vendor ? null : p.payeeName || null],
    ],
    ...files,
  };
  return {
    buffer: await buildPurchasingDocPdf(data, await loadCompanyLogo()),
    filename: filename("PAY", p.number, p.status),
    contentType: "application/pdf",
  };
}
