import ExcelJS from "exceljs";
import { Types } from "mongoose";
import { withTx } from "../../core/audit/context";
import type { CreateItemDto } from "../../dto/itemMaster.dto";
import { FolderRepo, type FolderInterface } from "../../models/folder.model";
import { ITEM_TYPES } from "../../models/item.model";
import { ItemRepo } from "../../models/item.model";
import { UomRepo } from "../../models/uom.model";
import { VendorRepo } from "../../models/vendor.model";
import {
  parseItemType,
  todayYmdUtc,
  toTitleCaseWords,
} from "../../validation/itemMaster";
import {
  formatDecimal,
  parsePositiveDecimal,
} from "./itemUomConvert";
import { itemMasterService } from "./itemMaster.service";

const ITEMS_HEADERS = [
  "Name",
  "Description",
  "Directory",
  "Vendor",
  "Uom",
  "Tarif",
  "ItemType",
] as const;

type FolderLean = FolderInterface & { _id: Types.ObjectId };

export type ItemBulkRowError = {
  row: number;
  message: string;
};

export class ItemBulkValidationError extends Error {
  readonly errors: ItemBulkRowError[];

  constructor(errors: ItemBulkRowError[]) {
    const message =
      errors.length === 1
        ? `Row ${errors[0]!.row}: ${errors[0]!.message}`
        : `${errors.length} row(s) failed validation`;
    super(message);
    this.name = "ItemBulkValidationError";
    this.errors = errors;
  }
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join("").trim();
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text.trim();
    }
    if ("result" in value) {
      return cellText(value.result as ExcelJS.CellValue);
    }
  }
  return String(value).trim();
}

function splitPath(raw: string): string[] {
  return raw
    .split(/\s*\/\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function buildFolderNamePaths(folders: FolderLean[]): string[] {
  const byId = new Map(folders.map((f) => [String(f._id), f]));
  const paths: string[] = [];
  for (const folder of folders) {
    const parts: string[] = [];
    let current: FolderLean | undefined = folder;
    const seen = new Set<string>();
    while (current) {
      const id = String(current._id);
      if (seen.has(id)) break;
      seen.add(id);
      parts.unshift(current.name);
      current = current.parentId
        ? byId.get(String(current.parentId))
        : undefined;
    }
    if (parts.length > 0) paths.push(parts.join(" / "));
  }
  paths.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return paths;
}

function resolveFolderIdByNamePath(
  pathRaw: string,
  folders: FolderLean[],
): string | null {
  const trimmed = pathRaw.trim();
  if (!trimmed || trimmed.toLowerCase() === "root") return null;

  const parts = splitPath(trimmed);
  if (parts.length === 0) return null;

  const byParent = new Map<string | null, FolderLean[]>();
  for (const f of folders) {
    const key = f.parentId ? String(f.parentId) : null;
    const list = byParent.get(key) ?? [];
    list.push(f);
    byParent.set(key, list);
  }

  let parentId: string | null = null;
  let matched: FolderLean | null = null;
  for (const part of parts) {
    const siblings: FolderLean[] = byParent.get(parentId) ?? [];
    const hit: FolderLean | undefined = siblings.find(
      (f: FolderLean) => f.name.toLowerCase() === part.toLowerCase(),
    );
    if (!hit) {
      throw new Error(`Unknown directory path: ${trimmed}`);
    }
    matched = hit;
    parentId = String(hit._id);
  }
  return matched ? String(matched._id) : null;
}

function headerMap(row: ExcelJS.Row): Map<string, number> {
  const map = new Map<string, number>();
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = cellText(cell.value).toLowerCase();
    if (key) map.set(key, colNumber);
  });
  return map;
}

function requireHeaders(map: Map<string, number>): void {
  const missing = ITEMS_HEADERS.filter(
    (h) => !map.has(h.toLowerCase()),
  );
  if (missing.length > 0) {
    throw new Error(
      `Items sheet header must include: ${ITEMS_HEADERS.join(", ")} (missing: ${missing.join(", ")})`,
    );
  }
}

type PreparedRow = {
  excelRow: number;
  dto: CreateItemDto;
  dupKey: string;
};

export class ItemBulkService {
  async buildTemplate(): Promise<Buffer> {
    const [vendors, uoms, folders] = await Promise.all([
      VendorRepo.model
        .find({ isActive: { $ne: false } })
        .sort({ name: 1 })
        .select({ name: 1 })
        .lean()
        .exec(),
      UomRepo.model
        .find({ isActive: { $ne: false } })
        .sort({ symbol: 1 })
        .select({ symbol: 1, name: 1 })
        .lean()
        .exec(),
      FolderRepo.model.find().lean().exec() as Promise<FolderLean[]>,
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Item Master";
    workbook.created = new Date();

    const items = workbook.addWorksheet("Items", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    items.addRow([...ITEMS_HEADERS]);
    items.getRow(1).font = { bold: true };
    items.getCell("A1").note =
      "Required. Title-cased on import. Unique per Directory.";
    items.getCell("C1").note =
      "Folder name path from Folders sheet (e.g. ITEM / Metal Materials). Leave empty for Root.";
    items.getCell("D1").note =
      "Optional. Exact match on Vendors sheet Name (case-insensitive).";
    items.getCell("E1").note =
      "Required. Match Uoms sheet Symbol (case-insensitive).";
    items.getCell("F1").note =
      "Optional amount. If set, creates one tarif with today's UTC date.";
    items.getCell("G1").note =
      "Required: material or labour (see ItemTypes sheet).";
    for (let i = 0; i < ITEMS_HEADERS.length; i += 1) {
      items.getColumn(i + 1).width = Math.max(14, ITEMS_HEADERS[i]!.length + 4);
    }

    const vendorsSheet = workbook.addWorksheet("Vendors");
    vendorsSheet.addRow(["Name", "Id"]);
    vendorsSheet.getRow(1).font = { bold: true };
    for (const v of vendors) {
      vendorsSheet.addRow([v.name, String(v._id)]);
    }
    vendorsSheet.columns = [{ width: 32 }, { width: 28 }];

    const uomsSheet = workbook.addWorksheet("Uoms");
    uomsSheet.addRow(["Symbol", "Name"]);
    uomsSheet.getRow(1).font = { bold: true };
    for (const u of uoms) {
      uomsSheet.addRow([u.symbol, u.name]);
    }
    uomsSheet.columns = [{ width: 14 }, { width: 28 }];

    const foldersSheet = workbook.addWorksheet("Folders");
    foldersSheet.addRow(["Path"]);
    foldersSheet.getRow(1).font = { bold: true };
    foldersSheet.getCell("A1").note =
      "Match Directory on Items by this Path. Leave Directory empty for Root.";
    foldersSheet.addRow([""]);
    foldersSheet.getCell("A2").note = "Empty Path = Root";
    for (const path of buildFolderNamePaths(folders)) {
      foldersSheet.addRow([path]);
    }
    foldersSheet.getColumn(1).width = 48;

    const typesSheet = workbook.addWorksheet("ItemTypes");
    typesSheet.addRow(["ItemType"]);
    typesSheet.getRow(1).font = { bold: true };
    for (const t of ITEM_TYPES) {
      typesSheet.addRow([t]);
    }
    typesSheet.getColumn(1).width = 14;

    const raw = await workbook.xlsx.writeBuffer();
    return Buffer.from(raw as ArrayBuffer);
  }

  async importBuffer(buffer: Buffer): Promise<{ created: number }> {
    const workbook = new ExcelJS.Workbook();
    // exceljs types pin an incompatible Buffer shape vs current @types/node
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new Error("Workbook has no worksheets");
    }

    const header = sheet.getRow(1);
    const cols = headerMap(header);
    requireHeaders(cols);

    const col = (name: (typeof ITEMS_HEADERS)[number]) =>
      cols.get(name.toLowerCase())!;

    const [vendors, uoms, folders] = await Promise.all([
      VendorRepo.model
        .find({ isActive: { $ne: false } })
        .select({ name: 1 })
        .lean()
        .exec(),
      UomRepo.model
        .find({ isActive: { $ne: false } })
        .select({ symbol: 1 })
        .lean()
        .exec(),
      FolderRepo.model.find().lean().exec() as Promise<FolderLean[]>,
    ]);

    const vendorByName = new Map(
      vendors.map((v) => [v.name.toLowerCase(), String(v._id)]),
    );
    const uomBySymbol = new Map(
      uoms.map((u) => [u.symbol.toLowerCase(), String(u._id)]),
    );

    const errors: ItemBulkRowError[] = [];
    const prepared: PreparedRow[] = [];
    const seenInFile = new Map<string, number>();

    const rowCount = sheet.rowCount;
    for (let r = 2; r <= rowCount; r += 1) {
      const row = sheet.getRow(r);
      const nameRaw = cellText(row.getCell(col("Name")).value);
      const description = cellText(row.getCell(col("Description")).value);
      const directory = cellText(row.getCell(col("Directory")).value);
      const vendorRaw = cellText(row.getCell(col("Vendor")).value);
      const uomRaw = cellText(row.getCell(col("Uom")).value);
      const tarifRaw = cellText(row.getCell(col("Tarif")).value);
      const itemTypeRaw = cellText(row.getCell(col("ItemType")).value);

      if (
        !nameRaw &&
        !description &&
        !directory &&
        !vendorRaw &&
        !uomRaw &&
        !tarifRaw &&
        !itemTypeRaw
      ) {
        continue;
      }

      const name = toTitleCaseWords(nameRaw);
      if (!name) {
        errors.push({ row: r, message: "Name is required" });
        continue;
      }

      let itemType: CreateItemDto["itemType"];
      try {
        itemType = parseItemType(itemTypeRaw.toLowerCase());
      } catch (e) {
        errors.push({
          row: r,
          message: e instanceof Error ? e.message : "Invalid ItemType",
        });
        continue;
      }

      let folderId: string | null;
      try {
        folderId = resolveFolderIdByNamePath(directory, folders);
      } catch (e) {
        errors.push({
          row: r,
          message: e instanceof Error ? e.message : "Invalid Directory",
        });
        continue;
      }

      let vendorIds: string[] = [];
      if (vendorRaw) {
        const vendorId = vendorByName.get(vendorRaw.toLowerCase());
        if (!vendorId) {
          errors.push({
            row: r,
            message: `Unknown vendor: ${vendorRaw}`,
          });
          continue;
        }
        vendorIds = [vendorId];
      }

      if (!uomRaw) {
        errors.push({ row: r, message: "Uom is required" });
        continue;
      }
      const uomId = uomBySymbol.get(uomRaw.toLowerCase());
      if (!uomId) {
        errors.push({ row: r, message: `Unknown Uom symbol: ${uomRaw}` });
        continue;
      }

      let tarifs: CreateItemDto["tarifs"] = [];
      if (tarifRaw) {
        try {
          const amount = formatDecimal(
            parsePositiveDecimal(tarifRaw, "Tarif"),
          );
          tarifs = [{ effectiveDate: todayYmdUtc(), amount }];
        } catch (e) {
          errors.push({
            row: r,
            message: e instanceof Error ? e.message : "Invalid Tarif",
          });
          continue;
        }
      }

      const dupKey = `${name.toLowerCase()}|${folderId ?? ""}`;
      const prior = seenInFile.get(dupKey);
      if (prior !== undefined) {
        errors.push({
          row: r,
          message: `Duplicate Name + Directory (same as row ${prior})`,
        });
        continue;
      }
      seenInFile.set(dupKey, r);

      prepared.push({
        excelRow: r,
        dupKey,
        dto: {
          name,
          description: description || undefined,
          itemType,
          folderId,
          vendorIds,
          uoms: [
            {
              uomId,
              isBase: true,
              conversionFactor: "1",
            },
          ],
          tarifs,
        },
      });
    }

    if (prepared.length === 0 && errors.length === 0) {
      throw new Error("No data rows to import");
    }

    if (prepared.length > 0) {
      const folderKeys = [
        ...new Set(prepared.map((p) => p.dto.folderId)),
      ];
      const existing = await ItemRepo.model
        .find({
          $or: folderKeys.map((fid) =>
            fid
              ? { folderId: new Types.ObjectId(fid) }
              : { folderId: null },
          ),
        })
        .select({ name: 1, folderId: 1 })
        .lean()
        .exec();

      const existingKeys = new Set(
        existing.map(
          (doc) =>
            `${String(doc.name).toLowerCase()}|${doc.folderId ? String(doc.folderId) : ""}`,
        ),
      );

      for (const row of prepared) {
        if (existingKeys.has(row.dupKey)) {
          errors.push({
            row: row.excelRow,
            message: `An item named "${row.dto.name}" already exists in this folder`,
          });
        }
      }
    }

    if (errors.length > 0) {
      errors.sort((a, b) => a.row - b.row);
      throw new ItemBulkValidationError(errors);
    }

    return withTx(async () => {
      for (const row of prepared) {
        try {
          await itemMasterService.createItem(row.dto);
        } catch (e) {
          throw new ItemBulkValidationError([
            {
              row: row.excelRow,
              message: e instanceof Error ? e.message : "Failed to create item",
            },
          ]);
        }
      }
      return { created: prepared.length };
    });
  }
}

export const itemBulkService = new ItemBulkService();
