import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import ExcelJS from "exceljs";
import type { ProjectQuotationOutDto } from "../../dto/projectQuotation.dto";
import { buildQuotationDocument } from "./quotation.document";
import { buildQuotationWorkbook } from "./quotation.xlsx";
import { fitBox, readLogoImageInfo } from "./quotation.logo";
import { buildQuotationPdf } from "./quotation.pdf";

/** Build a valid 2×1 RGB PNG. */
function makePng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PNG = makePng();

/** Minimal JPEG header: SOI, APP0 (len 16), SOF0 with 30×20. */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.alloc(14),
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x14, 0x00, 0x1e, 0x03]),
  Buffer.alloc(8),
]);

function sample(overrides: Partial<ProjectQuotationOutDto> = {}): ProjectQuotationOutDto {
  return {
    id: "q1",
    projectId: "p1",
    revision: 2,
    quotationNumber: "QUO/PRJ-001/R2",
    status: "issued",
    rabRevision: 1,
    grandTotal: "2498",
    createdAt: null,
    createdBy: null,
    issuedAt: "2026-10-24T03:00:00.000Z",
    issuedBy: null,
    wonAt: null,
    wonBy: null,
    subject: "Penawaran signage",
    markupPercent: "10",
    discountType: "percent",
    discountValue: "10",
    taxPercent: "11",
    validUntil: "2026-11-30",
    notes: "Harga belum termasuk pengiriman.\nGaransi 1 tahun.",
    termOfPaymentId: null,
    termOfPaymentText: "DP 50%, pelunasan 50%",
    company: {
      name: "PT Contoh",
      npwp: "01.234",
      address: "Jl. Mawar 1",
      phone: "021-1",
      email: "a@b.c",
      website: "",
      branchOfficeAddresses: [],
      hasLogo: true,
    },
    customer: { customerId: "c1", name: "PT Klien", address: "Jl. Melati", npwp: "" },
    contact: { name: "Sari", gender: "female", contact: {} },
    lines: [
      {
        key: "boq:1",
        kind: "item",
        shopDrawingItemId: null,
        shopDrawingFileId: null,
        description: "Pylon sign",
        qty: "2",
        uom: "unit",
        costUnitPrice: "700",
        unitPrice: "1000",
        priceOverridden: false,
        lineTotal: "2000",
        category: null,
        code: "",
        descriptions: [],
        dimension: "",
      },
      {
        key: "labour",
        kind: "labour",
        shopDrawingItemId: null,
        shopDrawingFileId: null,
        description: "Installation & labour",
        qty: "1",
        uom: "lot",
        costUnitPrice: "400",
        unitPrice: "500",
        priceOverridden: false,
        lineTotal: "500",
        category: null,
        code: "",
        descriptions: [],
        dimension: "",
      },
    ],
    totals: {
      costTotal: "1800",
      subtotal: "2500",
      discountAmount: "250",
      taxBase: "2250",
      taxAmount: "248",
      grandTotal: "2498",
      margin: "450",
    },
    sections: [],
    issuedByName: "Adrian Purnama",
    rabOutdated: false,
    verifyUrl: null,
    verifyState: "unavailable",
    ...overrides,
  };
}

describe("readLogoImageInfo", () => {
  it("reads PNG size", () => {
    assert.deepEqual(readLogoImageInfo(PNG), { kind: "png", width: 2, height: 1 });
  });
  it("reads JPEG size from SOF", () => {
    assert.deepEqual(readLogoImageInfo(JPEG), { kind: "jpeg", width: 30, height: 20 });
  });
  it("rejects other formats", () => {
    assert.equal(readLogoImageInfo(Buffer.from("<svg></svg>")), null);
  });
});

describe("fitBox", () => {
  it("keeps aspect ratio and never upscales", () => {
    assert.deepEqual(fitBox(400, 100, 180, 80), { width: 180, height: 45 });
    assert.deepEqual(fitBox(10, 10, 180, 80), { width: 10, height: 10 });
  });
});

describe("buildQuotationDocument", () => {
  it("shows discount, DPP and PPN rows and Ibu salutation", () => {
    const doc = buildQuotationDocument(sample());
    assert.deepEqual(
      doc.totals.map((t) => t.label),
      ["Subtotal", "Diskon 10%", "DPP", "PPN 11%", "Total"],
    );
    assert.ok(doc.meta.left.some(([k, v]) => k === "Up." && v === "Ibu Sari"));
    assert.deepEqual(
      doc.meta.right.map(([k]) => k),
      ["No.", "Tanggal", "Perihal"],
    );
    assert.equal(doc.title, "PENAWARAN HARGA");
  });
  it("splits multi-line company address and keeps website on its own line", () => {
    const base = sample();
    const doc = buildQuotationDocument(
      sample({
        company: {
          ...base.company,
          address: ["Jl. Mawar 1", "Gang Kenanga 2", ""].join("\r\n"),
          website: "https://example.com",
        },
      }),
    );
    assert.deepEqual(doc.letterhead, [
      "Jl. Mawar 1",
      "Gang Kenanga 2",
      "Telp: 021-1 · a@b.c",
      "https://example.com",
      "NPWP: 01.234",
    ]);
  });

  it("labels head and branch offices when branches exist", () => {
    const base = sample();
    const doc = buildQuotationDocument(
      sample({
        company: {
          ...base.company,
          address: "Jl. Raya 85-D\nSurabaya",
          branchOfficeAddresses: ["City Walk D/3\nJakarta", "  "],
        },
      }),
    );
    assert.deepEqual(doc.letterhead.slice(0, 4), [
      "Head Office: Jl. Raya 85-D",
      "Surabaya",
      "Branch Office: City Walk D/3",
      "Jakarta",
    ]);
  });

  it("prints flat rows and the issuer name when there are no sections", () => {
    const doc = buildQuotationDocument(sample());
    assert.deepEqual(
      doc.rows.map((r) => r.type),
      ["line", "line"],
    );
    assert.equal(doc.signerName, "Adrian Purnama");
  });

  it("prints category headers, per-category numbering and SUB TOTAL rows", () => {
    const doc = buildQuotationDocument(
      sample({
        sections: [
          { title: "OUTDOOR", numeral: "I", lineIndexes: [0], subtotal: "2000" },
          { title: "JASA", numeral: "II", lineIndexes: [1], subtotal: "500" },
        ],
      }),
    );
    assert.deepEqual(
      doc.rows.map((r) =>
        r.type === "line" ? r.no : r.type === "section" ? r.title : r.label,
      ),
      ["OUTDOOR", 1, "SUB TOTAL I", "JASA", 1, "SUB TOTAL II"],
    );
  });

  it("marks drafts in the title", () => {
    assert.match(buildQuotationDocument(sample({ status: "draft" })).title, /DRAFT/);
  });
});

describe("export builders", () => {
  it("embeds the logo in the workbook", async () => {
    const wb = buildQuotationWorkbook(buildQuotationDocument(sample()), {
      buffer: PNG,
      contentType: "image/png",
    });
    const ws = wb.getWorksheet("Quotation")!;
    assert.equal(ws.getImages().length, 1);
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(await wb.xlsx.writeBuffer());
    assert.ok(reread.getWorksheet("Quotation"));
  });

  it("produces a PDF with and without a logo", async () => {
    const doc = buildQuotationDocument(sample());
    const withLogo = await buildQuotationPdf(doc, { buffer: PNG, contentType: "image/png" });
    const without = await buildQuotationPdf(doc, null);
    assert.equal(withLogo.subarray(0, 5).toString(), "%PDF-");
    assert.equal(without.subarray(0, 5).toString(), "%PDF-");
    assert.ok(withLogo.length > without.length);
  });

  it("skips a corrupt logo instead of failing", async () => {
    const broken = Buffer.concat([PNG.subarray(0, 24), Buffer.alloc(8)]);
    const pdf = await buildQuotationPdf(buildQuotationDocument(sample()), {
      buffer: broken,
      contentType: "image/png",
    });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  });
});
