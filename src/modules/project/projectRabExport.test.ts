import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExportFilename,
  buildSections,
  exportChargeRows,
  lineAmount,
  missingPriceLines,
  sanitizeExcelText,
  sumLineAmounts,
  terbilangRupiah,
  toLetter,
  toRoman,
  type ExportLineIn,
} from "./projectRabExport.planner";

function line(partial: Partial<ExportLineIn> & Pick<ExportLineIn, "key">): ExportLineIn {
  return {
    materialItemId: "m1",
    materialCode: "MAT-1",
    materialName: "Besi",
    uomSymbol: "kg",
    totalQty: "2",
    unitPrice: "1000",
    origin: "lock",
    addReason: null,
    folderPath: [],
    vendorName: null,
    keterangan: "",
    kind: "material",
    ...partial,
  };
}

describe("sanitizeExcelText", () => {
  it("prefixes formula-like text", () => {
    assert.equal(sanitizeExcelText("=1+1"), "'=1+1");
    assert.equal(sanitizeExcelText("+cmd"), "'+cmd");
    assert.equal(sanitizeExcelText("-hack"), "'-hack");
    assert.equal(sanitizeExcelText("@x"), "'@x");
  });

  it("leaves normal text", () => {
    assert.equal(sanitizeExcelText("Besi beton"), "Besi beton");
  });
});

describe("terbilangRupiah", () => {
  it("handles zero and small amounts", () => {
    assert.equal(terbilangRupiah(0), "Nol Rupiah");
    assert.equal(terbilangRupiah(11), "Sebelas Rupiah");
    assert.equal(terbilangRupiah(1000), "Seribu Rupiah");
  });

  it("handles larger amounts", () => {
    assert.equal(terbilangRupiah(1_250_000), "Satu Juta Dua Ratus Lima Puluh Ribu Rupiah");
  });
});

describe("section labels", () => {
  it("romans and letters", () => {
    assert.equal(toRoman(1), "I");
    assert.equal(toRoman(4), "IV");
    assert.equal(toLetter(1), "A");
    assert.equal(toLetter(27), "AA");
  });
});

describe("buildSections", () => {
  it("groups by folder path; empty path is untitled first", () => {
    const sections = buildSections([
      line({ key: "a", materialName: "A", folderPath: ["Struktur", "Kolom"] }),
      line({ key: "b", materialName: "B", folderPath: ["Struktur", "Balok"] }),
      line({ key: "c", materialName: "C", folderPath: [] }),
      line({ key: "d", materialName: "D", folderPath: ["Finishing"] }),
    ]);
    assert.equal(sections.length, 3);
    assert.equal(sections[0]!.name, "");
    assert.equal(sections[0]!.roman, "I");
    assert.equal(sections[1]!.name, "Finishing");
    assert.equal(sections[1]!.roman, "II");
    assert.equal(sections[2]!.name, "Struktur");
    assert.equal(sections[2]!.roman, "III");
    assert.equal(sections[2]!.subsections.length, 2);
    assert.equal(sections[2]!.subsections[0]!.letter, "A");
  });
});

describe("missingPriceLines and totals", () => {
  it("lists lines without unit price", () => {
    const lines = [
      line({ key: "1", unitPrice: "100" }),
      line({ key: "2", unitPrice: null, materialName: "No price" }),
      line({ key: "3", unitPrice: "  ", materialCode: "X" }),
    ];
    const missing = missingPriceLines(lines);
    assert.equal(missing.length, 2);
    assert.deepEqual(
      missing.map((l) => l.key),
      ["2", "3"],
    );
  });

  it("sums amounts matching qty * price", () => {
    const lines = [
      line({ key: "1", totalQty: "3", unitPrice: "1500" }),
      line({ key: "2", totalQty: "2", unitPrice: "2500" }),
    ];
    assert.equal(lineAmount(lines[0]!), 4500);
    assert.equal(lineAmount(lines[1]!), 5000);
    assert.equal(sumLineAmounts(lines), 9500);
  });
});

describe("buildExportFilename", () => {
  it("marks draft in filename", () => {
    const name = buildExportFilename({
      projectCode: "PRJ-01",
      projectName: "Gedung A",
      revision: 0,
      draft: true,
      kind: "formal",
      date: new Date(Date.UTC(2026, 9, 23)),
    });
    assert.match(name, /^RAB_PRJ-01_Gedung_A_Rev0_DRAFT_20261023\.xlsx$/);
  });

  it("adds DATA infix for data kind", () => {
    const name = buildExportFilename({
      projectCode: "P1",
      projectName: "N",
      revision: 2,
      draft: false,
      kind: "data",
      date: new Date(Date.UTC(2026, 0, 5)),
    });
    assert.match(name, /_Rev2_DATA_20260105\.xlsx$/);
  });
});

describe("exportChargeRows", () => {
  it("prices percent charges on the subtotal and keeps fixed amounts", () => {
    const rows = exportChargeRows(1_000_005, [
      { label: "PPN", kind: "percent", rate: "11", amount: "0" },
      { label: "Ongkir", kind: "fixed", rate: null, amount: "250000" },
    ]);
    assert.deepEqual(rows, [
      { label: "PPN (11%)", rate: 11, amount: 110001 },
      { label: "Ongkir", rate: null, amount: 250000 },
    ]);
  });

  it("returns nothing without charges", () => {
    assert.deepEqual(exportChargeRows(5000, []), []);
  });
});
