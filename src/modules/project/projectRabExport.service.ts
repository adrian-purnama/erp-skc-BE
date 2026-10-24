import ExcelJS from "exceljs";
import { Types } from "mongoose";
import { FolderRepo } from "../../models/folder/folder.model";
import { ItemRepo } from "../../models/item/item.model";
import { VendorRepo } from "../../models/vendor/vendor.model";
import type { ProjectRabLine } from "../../models/projectRab/projectRab.model";
import { ProjectRabRepo } from "../../models/projectRab/projectRab.model";
import { ProjectRepo } from "../../models/project/project.model";
import { logger } from "../../logger/logger";
import { userEmailsById } from "../../utils/shared";
import { folderPathUp } from "../itemMaster/folderPath";
import { loadItemMeta } from "../itemMaster/itemMeta";
import {
  buildExportFilename,
  buildSections,
  lineAmount,
  missingPriceLines,
  sanitizeExcelText,
  sumLineAmounts,
  terbilangRupiah,
  toLetter,
  type ExportLineIn,
  type ExportSection,
} from "./projectRabExport.planner";
import { rabLineKey } from "./projectRab.planner";
import { projectRabChangeService } from "./projectRabChange.service";
import { assertProjectExists } from "./projectShared";
import { projectRabService } from "./projectRab.service";

export type RabExportKind = "formal" | "data";

export type RabExportResult = {
  buffer: Buffer;
  filename: string;
};

type FolderLean = {
  _id: Types.ObjectId;
  name: string;
  parentId?: Types.ObjectId | null;
};

const FONT = "Arial";
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};
const SECTION_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE7E6E6" },
};
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

function num(raw: string | null | undefined): number {
  const n = Number(raw ?? "");
  return Number.isFinite(n) ? n : 0;
}

async function folderPathByItemId(
  itemIds: string[],
): Promise<Map<string, string[]>> {
  const items = (await ItemRepo.model
    .find({ _id: { $in: itemIds.map((id) => new Types.ObjectId(id)) } })
    .select({ folderId: 1, vendorIds: 1 })
    .lean()
    .exec()) as Array<{
    _id: Types.ObjectId;
    folderId?: Types.ObjectId | null;
    vendorIds?: Types.ObjectId[];
  }>;
  const folders = (await FolderRepo.model.find().lean().exec()) as FolderLean[];
  const byId = new Map(folders.map((f) => [String(f._id), f]));

  const out = new Map<string, string[]>();
  for (const it of items) {
    const nodes = await folderPathUp(
      it.folderId ? String(it.folderId) : null,
      async (id) => {
        const folder = byId.get(id);
        return folder
          ? {
              parentId: folder.parentId ? String(folder.parentId) : null,
              value: folder.name,
            }
          : null;
      },
    );
    out.set(
      String(it._id),
      nodes.map((node) => node.value),
    );
  }
  return out;
}

async function vendorNameByItemId(
  itemIds: string[],
): Promise<Map<string, string | null>> {
  const items = (await ItemRepo.model
    .find({ _id: { $in: itemIds.map((id) => new Types.ObjectId(id)) } })
    .select({ vendorIds: 1 })
    .lean()
    .exec()) as Array<{ _id: Types.ObjectId; vendorIds?: Types.ObjectId[] }>;
  const vendorIds = [
    ...new Set(
      items.flatMap((i) => (i.vendorIds ?? []).map((v) => String(v))),
    ),
  ];
  const vendors =
    vendorIds.length === 0
      ? []
      : ((await VendorRepo.model
          .find({ _id: { $in: vendorIds.map((id) => new Types.ObjectId(id)) } })
          .select({ name: 1 })
          .lean()
          .exec()) as Array<{ _id: Types.ObjectId; name: string }>);
  const vNames = new Map(vendors.map((v) => [String(v._id), v.name]));
  const out = new Map<string, string | null>();
  for (const it of items) {
    const first = it.vendorIds?.[0] ? String(it.vendorIds[0]) : null;
    out.set(String(it._id), first ? (vNames.get(first) ?? null) : null);
  }
  return out;
}

export class ProjectRabExportService {
  async export(
    projectId: string,
    userId: string,
    kind: RabExportKind,
    revisionParam: string,
  ): Promise<RabExportResult> {
    await assertProjectExists(projectId);
    if (!Types.ObjectId.isValid(userId)) throw new Error("Invalid user id");

    const project = (await ProjectRepo.model
      .findById(projectId)
      .lean()
      .exec()) as { name: string; projectNumber: string } | null;
    if (!project) throw new Error("Project not found");

    const { lines, meta } = await this.resolveLines(projectId, userId, revisionParam);
    const isDraft = meta.status === "draft";
    const revisionLabel = meta.revision;

    if (kind === "formal" && !isDraft) {
      const missing = missingPriceLines(lines);
      if (missing.length > 0) {
        const list = missing
          .slice(0, 20)
          .map((l) => `${l.materialCode} ${l.materialName}`.trim())
          .join("; ");
        throw new Error(
          `Cannot export formal RAB: ${missing.length} line(s) missing unit price (${list}${missing.length > 20 ? "…" : ""})`,
        );
      }
    }

    const sections = buildSections(lines);
    const exportDate = new Date();
    const filename = buildExportFilename({
      projectCode: project.projectNumber,
      projectName: project.name,
      revision: revisionLabel,
      draft: isDraft,
      kind,
      date: exportDate,
    });

    const workbook =
      kind === "data"
        ? this.buildDataWorkbook({
            project,
            meta,
            lines,
            sections,
            exportDate,
          })
        : await this.buildFormalWorkbook({
            project,
            meta,
            lines,
            sections,
            exportDate,
            projectId,
            revisionIsHistorical:
              revisionParam !== "current" && revisionParam !== "",
          });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    logger.info(
      `RAB export kind=${kind} project=${projectId} rev=${revisionLabel} draft=${isDraft} user=${userId}`,
      "projectRabExport.service.ts",
      "export",
    );
    return { buffer, filename };
  }

  private async resolveLines(
    projectId: string,
    userId: string,
    revisionParam: string,
  ): Promise<{
    lines: ExportLineIn[];
    meta: {
      status: "draft" | "locked";
      revision: number;
      lockedAt: string | null;
      lockedByName: string | null;
      changeNotes: Map<string, string>;
    };
  }> {
    const rabDoc = (await ProjectRabRepo.model
      .findOne({ projectId: new Types.ObjectId(projectId) })
      .lean()
      .exec()) as {
      status?: string;
      lockedAt?: Date;
      lockedBy?: Types.ObjectId;
      lines: ProjectRabLine[];
    } | null;

    const status = (rabDoc?.status as "draft" | "locked") ?? "draft";
    let lockedByName: string | null = null;
    if (rabDoc?.lockedBy) {
      const names = await userEmailsById([String(rabDoc.lockedBy)]);
      lockedByName = names.get(String(rabDoc.lockedBy)) ?? null;
    }

    const changeNotes = new Map<string, string>();
    let rawLines: Array<{
      key: string;
      materialItemId: string;
      materialCode: string;
      materialName: string;
      uomSymbol: string;
      totalQty: string;
      unitPrice: string | null;
      origin: string | null;
      addReason: string | null;
    }> = [];
    let revision = 0;

    if (revisionParam === "current" || revisionParam === "") {
      const live = await projectRabService.get(projectId, userId);
      if (!live) throw new Error("RAB not found");
      revision = live.currentRevision;
      for (const g of live.groups) {
        for (const l of g.lines) {
          rawLines.push({
            key: l.key,
            materialItemId: l.materialItemId,
            materialCode: l.materialCode,
            materialName: l.materialName,
            uomSymbol: l.uomSymbol,
            totalQty: l.totalQty,
            unitPrice: l.unitPrice,
            origin: l.origin,
            addReason: l.addReason,
          });
          if (live.changeDiff) {
            const d = live.changeDiff.lineDiff.find((x) => x.key === l.key);
            if (d?.kind === "added") {
              changeNotes.set(
                l.key,
                `Tambah (Rev ${live.currentRevision + 1})`,
              );
            } else if (d?.kind === "changed") {
              changeNotes.set(
                l.key,
                `Ubah (Rev ${live.currentRevision + 1})`,
              );
            }
          } else if (l.origin === "append" || l.addReason) {
            changeNotes.set(l.key, `Tambah (Rev ${live.currentRevision})`);
          }
        }
      }
    } else {
      const rev = Number(revisionParam);
      if (!Number.isInteger(rev) || rev < 1) {
        throw new Error("Invalid revision");
      }
      const change = await projectRabChangeService.findCommittedByRevision(
        projectId,
        rev,
      );
      if (!change) throw new Error(`Revision ${rev} not found`);
      revision = rev;
      rawLines = await this.enrichSnapshotLines(change.rabLines);
      for (const l of rawLines) {
        if (l.origin === "append" || l.addReason) {
          changeNotes.set(l.key, `Tambah (Rev ${rev})`);
        }
      }
    }

    const itemIds = [...new Set(rawLines.map((l) => l.materialItemId))];
    const [paths, vendors] = await Promise.all([
      folderPathByItemId(itemIds),
      vendorNameByItemId(itemIds),
    ]);

    const lines: ExportLineIn[] = rawLines.map((l) => ({
      key: l.key,
      materialItemId: l.materialItemId,
      materialCode: l.materialCode,
      materialName: l.materialName,
      uomSymbol: l.uomSymbol,
      totalQty: l.totalQty,
      unitPrice: l.unitPrice,
      origin: l.origin,
      addReason: l.addReason,
      folderPath: paths.get(l.materialItemId) ?? [],
      vendorName: vendors.get(l.materialItemId) ?? null,
      keterangan: changeNotes.get(l.key) ?? "",
      kind: l.origin === "labour" ? "labour" : "material",
    }));

    return {
      lines,
      meta: {
        status,
        revision: status === "draft" ? 0 : revision,
        lockedAt: rabDoc?.lockedAt ? rabDoc.lockedAt.toISOString() : null,
        lockedByName,
        changeNotes,
      },
    };
  }

  private async enrichSnapshotLines(lines: ProjectRabLine[]): Promise<
    Array<{
      key: string;
      materialItemId: string;
      materialCode: string;
      materialName: string;
      uomSymbol: string;
      totalQty: string;
      unitPrice: string | null;
      origin: string | null;
      addReason: string | null;
    }>
  > {
    const itemIds = [...new Set(lines.map((l) => String(l.materialItemId)))];
    const { items: meta, uoms: uomMeta } = await loadItemMeta(itemIds);
    return lines.map((l) => {
      const mid = String(l.materialItemId);
      const m = meta.get(mid) ?? { code: "—", name: "Unknown" };
      return {
        key: l.key,
        materialItemId: mid,
        materialCode: m.code,
        materialName: m.name,
        uomSymbol: uomMeta.get(String(l.itemUomId))?.symbol ?? "—",
        totalQty: l.totalQty,
        unitPrice: l.unitPrice ?? null,
        origin: l.origin ?? null,
        addReason: l.addReason?.trim() ? l.addReason.trim() : null,
      };
    });
  }

  private applyMetaHeader(
    sheet: ExcelJS.Worksheet,
    startRow: number,
    opts: {
      project: { name: string; projectNumber: string };
      meta: {
        status: string;
        revision: number;
        lockedAt: string | null;
        lockedByName: string | null;
      };
      exportDate: Date;
      draft: boolean;
    },
  ): number {
    let r = startRow;
    sheet.getCell(r, 1).value = "Project Name";
    sheet.getCell(r, 2).value = sanitizeExcelText(opts.project.name);
    r += 1;
    sheet.getCell(r, 1).value = "Project Code";
    sheet.getCell(r, 2).value = sanitizeExcelText(opts.project.projectNumber);
    r += 1;
    sheet.getCell(r, 1).value = "Revision";
    sheet.getCell(r, 2).value = opts.draft
      ? `Rev ${opts.meta.revision} (DRAFT)`
      : `Rev ${opts.meta.revision}`;
    r += 1;
    sheet.getCell(r, 1).value = "Lock status";
    sheet.getCell(r, 2).value = opts.draft
      ? "DRAFT — not locked"
      : `Locked${opts.meta.lockedByName ? ` by ${opts.meta.lockedByName}` : ""}${opts.meta.lockedAt ? ` on ${opts.meta.lockedAt}` : ""}`;
    r += 1;
    sheet.getCell(r, 1).value = "Export date";
    sheet.getCell(r, 2).value = opts.exportDate.toISOString();
    return r + 1;
  }

  private buildDataWorkbook(opts: {
    project: { name: string; projectNumber: string };
    meta: {
      status: "draft" | "locked";
      revision: number;
      lockedAt: string | null;
      lockedByName: string | null;
    };
    lines: ExportLineIn[];
    sections: ExportSection[];
    exportDate: Date;
  }): ExcelJS.Workbook {
    const wb = new ExcelJS.Workbook();
    wb.creator = "RAB Export";
    const sheet = wb.addWorksheet("DATA", {
      views: [{ state: "frozen", ySplit: 7, showGridLines: false }],
    });
    const draft = opts.meta.status === "draft";
    let row = this.applyMetaHeader(sheet, 1, {
      project: opts.project,
      meta: opts.meta,
      exportDate: opts.exportDate,
      draft,
    });
    row += 1;
    const headers = [
      "Project Code",
      "Project Name",
      "Revision",
      "Section",
      "Item Name",
      "Type",
      "Vendor",
      "Qty",
      "UOM",
      "Unit Price",
      "Amount",
      "Change Status",
    ];
    const headerRow = row;
    sheet.getRow(row).values = headers;
    sheet.getRow(row).font = { name: FONT, size: 10, bold: true };
    sheet.getRow(row).fill = HEADER_FILL;
    row += 1;

    for (const section of opts.sections) {
      for (const sub of section.subsections) {
        const sectionLabel = sub.name
          ? `${section.name} / ${sub.name}`
          : section.name;
        for (const line of sub.lines) {
          const r = row;
          sheet.getCell(r, 1).value = sanitizeExcelText(
            opts.project.projectNumber,
          );
          sheet.getCell(r, 2).value = sanitizeExcelText(opts.project.name);
          sheet.getCell(r, 3).value = draft
            ? `Rev ${opts.meta.revision} DRAFT`
            : `Rev ${opts.meta.revision}`;
          sheet.getCell(r, 4).value = sanitizeExcelText(sectionLabel);
          sheet.getCell(r, 5).value = sanitizeExcelText(line.materialName);
          sheet.getCell(r, 6).value =
            line.kind === "labour" ? "Labour" : "Material";
          sheet.getCell(r, 7).value = sanitizeExcelText(
            line.vendorName ?? "—",
          );
          sheet.getCell(r, 8).value = num(line.totalQty);
          sheet.getCell(r, 9).value = sanitizeExcelText(line.uomSymbol);
          sheet.getCell(r, 10).value =
            line.unitPrice != null && line.unitPrice !== ""
              ? num(line.unitPrice)
              : null;
          sheet.getCell(r, 11).value = {
            formula: `${toLetter(8)}${r}*${toLetter(10)}${r}`,
          };
          sheet.getCell(r, 12).value = sanitizeExcelText(
            line.keterangan || "—",
          );
          for (let c = 1; c <= 12; c += 1) {
            sheet.getCell(r, c).font = { name: FONT, size: 10 };
            sheet.getCell(r, c).border = THIN_BORDER;
          }
          sheet.getCell(r, 8).numFmt = "#,##0.00";
          sheet.getCell(r, 10).numFmt = "#,##0";
          sheet.getCell(r, 11).numFmt = "#,##0";
          row += 1;
        }
      }
    }

    sheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: Math.max(headerRow, row - 1), column: 12 },
    };
    const widths = [14, 28, 14, 28, 36, 12, 20, 12, 10, 14, 14, 18];
    widths.forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });
    return wb;
  }

  private async buildFormalWorkbook(opts: {
    project: { name: string; projectNumber: string };
    meta: {
      status: "draft" | "locked";
      revision: number;
      lockedAt: string | null;
      lockedByName: string | null;
    };
    lines: ExportLineIn[];
    sections: ExportSection[];
    exportDate: Date;
    projectId: string;
    revisionIsHistorical: boolean;
  }): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    wb.creator = "RAB Export";
    const draft = opts.meta.status === "draft";
    const sectionSubtotalCells: Array<{ name: string; cell: string }> = [];

    // Create REKAPITULASI first (sheet order), fill after RAB subtotals known.
    const rek = wb.addWorksheet("REKAPITULASI", {
      views: [{ showGridLines: false }],
    });

    // —— Sheet RAB (detail) ——
    const rab = wb.addWorksheet("RAB", {
      views: [{ state: "frozen", ySplit: 9, showGridLines: false }],
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
      headerFooter: {
        oddFooter: "Halaman &P dari &N",
      },
    });

    rab.mergeCells("A1:G1");
    rab.getCell("A1").value = draft
      ? "RENCANA ANGGARAN BIAYA (DRAFT)"
      : "RENCANA ANGGARAN BIAYA";
    rab.getCell("A1").font = { name: FONT, size: 14, bold: true };
    rab.getCell("A1").alignment = { horizontal: "center" };

    let r = this.applyMetaHeader(rab, 3, {
      project: opts.project,
      meta: opts.meta,
      exportDate: opts.exportDate,
      draft,
    });
    r += 1;

    const headers = [
      "NO",
      "URAIAN PEKERJAAN",
      "VOLUME",
      "SATUAN",
      "HARGA SATUAN (Rp)",
      "JUMLAH HARGA (Rp)",
      "KETERANGAN",
    ];
    const headerRow = r;
    rab.getRow(r).values = headers;
    rab.getRow(r).font = { name: FONT, size: 10, bold: true };
    rab.getRow(r).fill = HEADER_FILL;
    for (let c = 1; c <= 7; c += 1) {
      rab.getCell(r, c).border = THIN_BORDER;
      rab.getCell(r, c).alignment = {
        horizontal: c === 2 ? "left" : c === 1 || c === 4 ? "center" : "right",
        wrapText: c === 2 || c === 7,
      };
    }
    rab.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
    r += 1;

    for (const section of opts.sections) {
      const sectionLabel = section.name || "—";
      if (section.name !== "") {
        rab.getCell(r, 1).value = section.roman;
        rab.getCell(r, 2).value = sanitizeExcelText(section.name);
        for (let c = 1; c <= 7; c += 1) {
          rab.getCell(r, c).font = { name: FONT, size: 10, bold: true };
          rab.getCell(r, c).fill = SECTION_FILL;
          rab.getCell(r, c).border = THIN_BORDER;
        }
        rab.getCell(r, 1).alignment = { horizontal: "center" };
        r += 1;
      }

      const itemAmountRows: number[] = [];
      for (const sub of section.subsections) {
        if (sub.letter && sub.name) {
          rab.getCell(r, 1).value = sub.letter;
          rab.getCell(r, 2).value = sanitizeExcelText(sub.name);
          for (let c = 1; c <= 7; c += 1) {
            rab.getCell(r, c).font = { name: FONT, size: 10, bold: true };
            rab.getCell(r, c).border = THIN_BORDER;
          }
          rab.getCell(r, 1).alignment = { horizontal: "center" };
          r += 1;
        }
        let itemNo = 0;
        for (const line of sub.lines) {
          itemNo += 1;
          rab.getCell(r, 1).value = itemNo;
          rab.getCell(r, 2).value = sanitizeExcelText(line.materialName);
          rab.getCell(r, 3).value = num(line.totalQty);
          rab.getCell(r, 4).value = sanitizeExcelText(line.uomSymbol);
          rab.getCell(r, 5).value =
            line.unitPrice != null && line.unitPrice !== ""
              ? num(line.unitPrice)
              : null;
          rab.getCell(r, 6).value = {
            formula: `C${r}*E${r}`,
          };
          rab.getCell(r, 7).value = sanitizeExcelText(line.keterangan);
          for (let c = 1; c <= 7; c += 1) {
            rab.getCell(r, c).font = { name: FONT, size: 10 };
            rab.getCell(r, c).border = THIN_BORDER;
          }
          rab.getCell(r, 1).alignment = { horizontal: "center" };
          rab.getCell(r, 3).numFmt = "#,##0.00";
          rab.getCell(r, 3).alignment = { horizontal: "right" };
          rab.getCell(r, 4).alignment = { horizontal: "center" };
          rab.getCell(r, 5).numFmt = "#,##0";
          rab.getCell(r, 5).alignment = { horizontal: "right" };
          rab.getCell(r, 6).numFmt = "#,##0";
          rab.getCell(r, 6).alignment = { horizontal: "right" };
          itemAmountRows.push(r);
          r += 1;
        }
      }

      rab.getCell(r, 2).value =
        section.name === "" ? "Jumlah" : `Jumlah ${section.name}`;
      rab.getCell(r, 2).font = { name: FONT, size: 10, bold: true };
      if (itemAmountRows.length > 0) {
        const parts = itemAmountRows.map((rr) => `F${rr}`).join(",");
        rab.getCell(r, 6).value = { formula: `SUM(${parts})` };
      } else {
        rab.getCell(r, 6).value = 0;
      }
      rab.getCell(r, 6).numFmt = "#,##0";
      rab.getCell(r, 6).font = { name: FONT, size: 10, bold: true };
      for (let c = 1; c <= 7; c += 1) {
        rab.getCell(r, c).border = THIN_BORDER;
        rab.getCell(r, c).font = {
          name: FONT,
          size: 10,
          bold: true,
        };
      }
      sectionSubtotalCells.push({
        name: sectionLabel,
        cell: `'RAB'!F${r}`,
      });
      r += 2;
    }

    rab.getColumn(1).width = 6;
    rab.getColumn(2).width = 50;
    rab.getColumn(3).width = 12;
    rab.getColumn(4).width = 10;
    rab.getColumn(5).width = 18;
    rab.getColumn(6).width = 20;
    rab.getColumn(7).width = 25;

    // —— Fill REKAPITULASI ——
    rek.mergeCells("A1:C1");
    rek.getCell("A1").value = draft
      ? "REKAPITULASI RAB (DRAFT)"
      : "REKAPITULASI RAB";
    rek.getCell("A1").font = { name: FONT, size: 14, bold: true };
    this.applyMetaHeader(rek, 3, {
      project: opts.project,
      meta: opts.meta,
      exportDate: opts.exportDate,
      draft,
    });
    let rr = 9;
    rek.getRow(rr).values = ["NO", "URAIAN PEKERJAAN", "JUMLAH HARGA (Rp)"];
    rek.getRow(rr).font = { name: FONT, size: 10, bold: true };
    rek.getRow(rr).fill = HEADER_FILL;
    for (let c = 1; c <= 3; c += 1) rek.getCell(rr, c).border = THIN_BORDER;
    rr += 1;
    const rekAmountRows: number[] = [];
    opts.sections.forEach((section, i) => {
      rek.getCell(rr, 1).value = section.roman;
      rek.getCell(rr, 2).value = sanitizeExcelText(
        sectionSubtotalCells[i]?.name ?? (section.name || "—"),
      );
      const ref = sectionSubtotalCells[i]?.cell ?? "0";
      rek.getCell(rr, 3).value = { formula: ref };
      rek.getCell(rr, 3).numFmt = "#,##0";
      for (let c = 1; c <= 3; c += 1) {
        rek.getCell(rr, c).font = { name: FONT, size: 10 };
        rek.getCell(rr, c).border = THIN_BORDER;
      }
      rekAmountRows.push(rr);
      rr += 1;
    });
    rr += 1;
    const jumlahRow = rr;
    rek.getCell(rr, 2).value = "JUMLAH";
    rek.getCell(rr, 2).font = { name: FONT, size: 10, bold: true };
    if (rekAmountRows.length > 0) {
      rek.getCell(rr, 3).value = {
        formula: `SUM(${rekAmountRows.map((x) => `C${x}`).join(",")})`,
      };
    } else {
      rek.getCell(rr, 3).value = 0;
    }
    rek.getCell(rr, 3).numFmt = "#,##0";
    rek.getCell(rr, 3).font = { name: FONT, size: 10, bold: true };
    rr += 2;
    // Before PPN (no tax rows on this sheet)
    const beforePpnTotal = sumLineAmounts(opts.lines);
    rek.getCell(rr, 1).value = "Terbilang";
    rek.mergeCells(`B${rr}:C${rr}`);
    rek.getCell(rr, 2).value = sanitizeExcelText(
      terbilangRupiah(beforePpnTotal),
    );
    rek.getCell(rr, 2).font = { name: FONT, size: 10, italic: true };
    // TODO: signature block later (Tempat/Tanggal, Dibuat / Diperiksa / Disetujui)
    rek.getColumn(1).width = 8;
    rek.getColumn(2).width = 40;
    rek.getColumn(3).width = 22;

    // —— ELABORASI ——
    await this.buildElaborasiSheet(wb, {
      project: opts.project,
      meta: opts.meta,
      exportDate: opts.exportDate,
      draft,
      projectId: opts.projectId,
      lines: opts.lines,
      revisionIsHistorical: opts.revisionIsHistorical,
    });

    // —— RIWAYAT ——
    const changes = await projectRabChangeService.list(opts.projectId);
    const committed = changes
      .filter((c) => c.status === "committed" && c.revision != null)
      .sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0));
    if (committed.length > 0) {
      const hist = wb.addWorksheet("RIWAYAT PERUBAHAN", {
        views: [{ showGridLines: false }],
      });
      this.applyMetaHeader(hist, 1, {
        project: opts.project,
        meta: opts.meta,
        exportDate: opts.exportDate,
        draft,
      });
      let h = 8;
      hist.getRow(h).values = [
        "Revision",
        "Reason",
        "Committed by",
        "Committed at",
        "Total difference",
      ];
      hist.getRow(h).font = { name: FONT, size: 10, bold: true };
      hist.getRow(h).fill = HEADER_FILL;
      h += 1;
      let prevTotal: number | null = null;
      for (const c of committed) {
        const snap = await projectRabChangeService.findCommittedByRevision(
          opts.projectId,
          c.revision!,
        );
        const total = snap
          ? sumLineAmounts(
              (
                await this.enrichSnapshotLines(snap.rabLines)
              ).map((l) => ({
                ...l,
                folderPath: [],
                vendorName: null,
                keterangan: "",
                kind:
                  l.origin === "labour"
                    ? ("labour" as const)
                    : ("material" as const),
              })),
            )
          : 0;
        const delta = prevTotal === null ? total : total - prevTotal;
        prevTotal = total;
        hist.getCell(h, 1).value = c.revision;
        hist.getCell(h, 2).value = sanitizeExcelText(c.reason);
        hist.getCell(h, 3).value = sanitizeExcelText(
          c.committedBy?.name ?? "—",
        );
        hist.getCell(h, 4).value = c.committedAt ?? "";
        hist.getCell(h, 5).value = delta;
        hist.getCell(h, 5).numFmt = "#,##0";
        h += 1;
      }
      hist.getColumn(1).width = 10;
      hist.getColumn(2).width = 40;
      hist.getColumn(3).width = 28;
      hist.getColumn(4).width = 24;
      hist.getColumn(5).width = 18;
    }

    return wb;
  }

  private async buildElaborasiSheet(
    wb: ExcelJS.Workbook,
    opts: {
      project: { name: string; projectNumber: string };
      meta: {
        status: "draft" | "locked";
        revision: number;
        lockedAt: string | null;
        lockedByName: string | null;
      };
      exportDate: Date;
      draft: boolean;
      projectId: string;
      lines: ExportLineIn[];
      revisionIsHistorical: boolean;
    },
  ): Promise<void> {
    const sheet = wb.addWorksheet("ELABORASI", {
      views: [{ showGridLines: false }],
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    let er = this.applyMetaHeader(sheet, 1, {
      project: opts.project,
      meta: opts.meta,
      exportDate: opts.exportDate,
      draft: opts.draft,
    });
    if (opts.revisionIsHistorical) {
      er += 1;
      sheet.mergeCells(`A${er}:K${er}`);
      sheet.getCell(er, 1).value = sanitizeExcelText(
        "Note: BOQ structure is current; unit prices are from the selected revision.",
      );
      sheet.getCell(er, 1).font = { name: FONT, size: 9, italic: true };
    }
    er += 1;

    const headers = [
      "Shop drawing",
      "File",
      "Block",
      "Code",
      "Material",
      "UOM",
      "Qty / unit",
      "Make qty",
      "Total qty",
      "Unit price (Rp)",
      "Amount (Rp)",
    ];
    sheet.getRow(er).values = headers;
    sheet.getRow(er).font = { name: FONT, size: 10, bold: true };
    sheet.getRow(er).fill = HEADER_FILL;
    for (let c = 1; c <= 11; c += 1) {
      sheet.getCell(er, c).border = THIN_BORDER;
    }
    er += 1;

    const priceByKey = new Map<string, string | null>();
    for (const line of opts.lines) {
      if (line.kind !== "material") continue;
      priceByKey.set(line.key, line.unitPrice);
    }

    const elaboration = await projectRabService.elaboration(opts.projectId);
    const docSubtotalRows: number[] = [];

    for (const doc of elaboration.documents) {
      sheet.mergeCells(`A${er}:K${er}`);
      sheet.getCell(er, 1).value = sanitizeExcelText(
        `${doc.shopDrawingItemName} · v${doc.fileVersion} · ${doc.originalFilename}`,
      );
      sheet.getCell(er, 1).font = { name: FONT, size: 10, bold: true };
      sheet.getCell(er, 1).fill = SECTION_FILL;
      for (let c = 1; c <= 11; c += 1) {
        sheet.getCell(er, c).border = THIN_BORDER;
        sheet.getCell(er, c).fill = SECTION_FILL;
      }
      er += 1;

      const amountRows: number[] = [];
      const fileLabel = `v${doc.fileVersion} ${doc.originalFilename}`;
      for (const block of doc.blocks) {
        for (const line of block.lines) {
          const key = rabLineKey(line.materialItemId, line.itemUomId);
          const unitPrice = priceByKey.get(key) ?? null;
          sheet.getCell(er, 1).value = sanitizeExcelText(
            doc.shopDrawingItemName,
          );
          sheet.getCell(er, 2).value = sanitizeExcelText(fileLabel);
          sheet.getCell(er, 3).value = sanitizeExcelText(block.title);
          sheet.getCell(er, 4).value = sanitizeExcelText(line.materialCode);
          sheet.getCell(er, 5).value = sanitizeExcelText(line.materialName);
          sheet.getCell(er, 6).value = sanitizeExcelText(line.uomSymbol);
          sheet.getCell(er, 7).value = num(line.qtyPerUnit);
          sheet.getCell(er, 8).value = num(line.makeQty);
          sheet.getCell(er, 9).value = num(line.totalQty);
          sheet.getCell(er, 10).value =
            unitPrice != null && unitPrice !== "" ? num(unitPrice) : null;
          sheet.getCell(er, 11).value = { formula: `I${er}*J${er}` };
          for (let c = 1; c <= 11; c += 1) {
            sheet.getCell(er, c).font = { name: FONT, size: 10 };
            sheet.getCell(er, c).border = THIN_BORDER;
          }
          sheet.getCell(er, 7).numFmt = "#,##0.00";
          sheet.getCell(er, 8).numFmt = "#,##0.00";
          sheet.getCell(er, 9).numFmt = "#,##0.00";
          sheet.getCell(er, 10).numFmt = "#,##0";
          sheet.getCell(er, 11).numFmt = "#,##0";
          amountRows.push(er);
          er += 1;
        }
      }

      sheet.getCell(er, 5).value = "Subtotal";
      sheet.getCell(er, 5).font = { name: FONT, size: 10, bold: true };
      if (amountRows.length > 0) {
        sheet.getCell(er, 11).value = {
          formula: `SUM(${amountRows.map((row) => `K${row}`).join(",")})`,
        };
      } else {
        sheet.getCell(er, 11).value = 0;
      }
      sheet.getCell(er, 11).numFmt = "#,##0";
      sheet.getCell(er, 11).font = { name: FONT, size: 10, bold: true };
      for (let c = 1; c <= 11; c += 1) {
        sheet.getCell(er, c).border = THIN_BORDER;
      }
      docSubtotalRows.push(er);
      er += 2;
    }

    const materialJumlahRow = er;
    sheet.getCell(er, 5).value = "Jumlah material";
    sheet.getCell(er, 5).font = { name: FONT, size: 10, bold: true };
    if (docSubtotalRows.length > 0) {
      sheet.getCell(er, 11).value = {
        formula: `SUM(${docSubtotalRows.map((row) => `K${row}`).join(",")})`,
      };
    } else {
      sheet.getCell(er, 11).value = 0;
    }
    sheet.getCell(er, 11).numFmt = "#,##0";
    sheet.getCell(er, 11).font = { name: FONT, size: 10, bold: true };
    for (let c = 1; c <= 11; c += 1) {
      sheet.getCell(er, c).border = THIN_BORDER;
    }
    er += 2;

    const labourLines = opts.lines.filter((l) => l.kind === "labour");
    sheet.mergeCells(`A${er}:K${er}`);
    sheet.getCell(er, 1).value = "Labour";
    sheet.getCell(er, 1).font = { name: FONT, size: 10, bold: true };
    for (let c = 1; c <= 11; c += 1) {
      sheet.getCell(er, c).border = THIN_BORDER;
      sheet.getCell(er, c).fill = SECTION_FILL;
    }
    er += 1;

    const labourAmountRows: number[] = [];
    for (const line of labourLines) {
      sheet.getCell(er, 1).value = "—";
      sheet.getCell(er, 2).value = "—";
      sheet.getCell(er, 3).value = "Labour";
      sheet.getCell(er, 4).value = sanitizeExcelText(line.materialCode);
      sheet.getCell(er, 5).value = sanitizeExcelText(line.materialName);
      sheet.getCell(er, 6).value = sanitizeExcelText(line.uomSymbol);
      sheet.getCell(er, 7).value = num(line.totalQty);
      sheet.getCell(er, 8).value = 1;
      sheet.getCell(er, 9).value = num(line.totalQty);
      sheet.getCell(er, 10).value =
        line.unitPrice != null && line.unitPrice !== ""
          ? num(line.unitPrice)
          : null;
      sheet.getCell(er, 11).value = { formula: `I${er}*J${er}` };
      for (let c = 1; c <= 11; c += 1) {
        sheet.getCell(er, c).font = { name: FONT, size: 10 };
        sheet.getCell(er, c).border = THIN_BORDER;
      }
      sheet.getCell(er, 7).numFmt = "#,##0.00";
      sheet.getCell(er, 8).numFmt = "#,##0.00";
      sheet.getCell(er, 9).numFmt = "#,##0.00";
      sheet.getCell(er, 10).numFmt = "#,##0";
      sheet.getCell(er, 11).numFmt = "#,##0";
      labourAmountRows.push(er);
      er += 1;
    }

    const labourJumlahRow = er;
    sheet.getCell(er, 5).value = "Jumlah labour";
    sheet.getCell(er, 5).font = { name: FONT, size: 10, bold: true };
    if (labourAmountRows.length > 0) {
      sheet.getCell(er, 11).value = {
        formula: `SUM(${labourAmountRows.map((row) => `K${row}`).join(",")})`,
      };
    } else {
      sheet.getCell(er, 11).value = 0;
    }
    sheet.getCell(er, 11).numFmt = "#,##0";
    sheet.getCell(er, 11).font = { name: FONT, size: 10, bold: true };
    for (let c = 1; c <= 11; c += 1) {
      sheet.getCell(er, c).border = THIN_BORDER;
    }
    er += 2;

    sheet.getCell(er, 5).value = "Jumlah";
    sheet.getCell(er, 5).font = { name: FONT, size: 10, bold: true };
    sheet.getCell(er, 11).value = {
      formula: `K${materialJumlahRow}+K${labourJumlahRow}`,
    };
    sheet.getCell(er, 11).numFmt = "#,##0";
    sheet.getCell(er, 11).font = { name: FONT, size: 10, bold: true };
    for (let c = 1; c <= 11; c += 1) {
      sheet.getCell(er, c).border = THIN_BORDER;
    }

    sheet.getColumn(1).width = 22;
    sheet.getColumn(2).width = 28;
    sheet.getColumn(3).width = 28;
    sheet.getColumn(4).width = 12;
    sheet.getColumn(5).width = 32;
    sheet.getColumn(6).width = 8;
    sheet.getColumn(7).width = 12;
    sheet.getColumn(8).width = 10;
    sheet.getColumn(9).width = 12;
    sheet.getColumn(10).width = 14;
    sheet.getColumn(11).width = 14;
  }
}

export const projectRabExportService = new ProjectRabExportService();
