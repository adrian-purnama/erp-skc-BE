import { Types } from "mongoose";
import type { ItemUomInDto, ItemUomOutDto } from "../../dto/itemMaster.dto";
import { ItemRepo } from "../../models/item/item.model";
import { ItemUomRepo, type ItemUomInterface } from "../../models/itemUom/itemUom.model";
import { UomRepo } from "../../models/uom/uom.model";
import { defaultFormulasOr } from "../uom/uomFormula";
import {
  parsePositiveDecimal,
  rescaleFactorsForNewBase,
  type RescaleRow,
} from "./itemUomConvert";

type ItemUomLean = ItemUomInterface & { _id: Types.ObjectId };

type UomMeta = {
  symbol: string;
  name: string;
  formulas: string[];
};

function toOut(doc: ItemUomLean, uomMeta?: UomMeta): ItemUomOutDto {
  return {
    id: String(doc._id),
    itemId: String(doc.itemId),
    uomId: String(doc.uomId),
    isBase: doc.isBase,
    conversionFactor: doc.conversionFactor,
    sortOrder: doc.sortOrder,
    symbol: uomMeta?.symbol ?? "",
    name: uomMeta?.name ?? "",
    formulas: defaultFormulasOr(uomMeta?.formulas),
  };
}

function validateRowShape(rows: ItemUomInDto[]): void {
  if (rows.length === 0) {
    throw new Error("At least one UOM is required");
  }

  const baseCount = rows.filter((r) => r.isBase).length;
  if (baseCount !== 1) {
    throw new Error("Exactly one base UOM is required");
  }

  const seen = new Set<string>();
  for (const row of rows) {
    if (!Types.ObjectId.isValid(row.uomId)) {
      throw new Error("Invalid uomId");
    }
    if (seen.has(row.uomId)) {
      throw new Error("Duplicate UOM on item");
    }
    seen.add(row.uomId);

    if (row.isBase) continue;
    if (row.conversionFactor == null) continue;
    parsePositiveDecimal(row.conversionFactor, "conversionFactor");
  }
}

/**
 * Build factors relative to the previous base for rescale.
 * Prefer original payload factors; fall back to existing DB factors.
 */
function factorsRelativeToPreviousBase(
  rows: ItemUomInDto[],
  existing: ItemUomLean[],
  previousBaseUomId: string | null,
): RescaleRow[] {
  const existingByUom = new Map(
    existing.map((d) => [String(d.uomId), d]),
  );

  return rows.map((row) => {
    if (row.uomId === previousBaseUomId) {
      return {
        uomId: row.uomId,
        isBase: row.isBase,
        conversionFactor: "1",
      };
    }

    const existingRow = existingByUom.get(row.uomId);
    let factor: string | null;
    if (row.isBase) {
      // Base flag forces "1" in storage; for rescale use prior related factor.
      if (
        row.conversionFactor != null &&
        row.conversionFactor !== "" &&
        row.conversionFactor !== "1"
      ) {
        factor = row.conversionFactor;
      } else if (existingRow?.conversionFactor != null) {
        factor = existingRow.conversionFactor;
      } else {
        factor = row.conversionFactor;
      }
    } else if (row.conversionFactor !== undefined) {
      factor = row.conversionFactor;
    } else {
      factor = existingRow?.conversionFactor ?? null;
    }

    return {
      uomId: row.uomId,
      isBase: row.isBase,
      conversionFactor: factor,
    };
  });
}

export class ItemUomService {
  async listByItem(itemId: string): Promise<ItemUomOutDto[]> {
    if (!Types.ObjectId.isValid(itemId)) return [];
    const docs = await ItemUomRepo.model
      .find({ itemId })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean()
      .exec();
    if (docs.length === 0) return [];

    const uomIds = docs.map((d) => d.uomId);
    const uoms = await UomRepo.model
      .find({ _id: { $in: uomIds } })
      .lean()
      .exec();
    const meta = new Map(
      uoms.map((u) => [
        String(u._id),
        {
          symbol: u.symbol,
          name: u.name,
          formulas: defaultFormulasOr(u.formulas),
        },
      ]),
    );

    return docs.map((doc) =>
      toOut(doc as ItemUomLean, meta.get(String(doc.uomId))),
    );
  }

  async replaceForItem(
    itemId: string,
    rows: ItemUomInDto[],
  ): Promise<ItemUomOutDto[]> {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new Error("Item not found");
    }
    validateRowShape(rows);

    const itemOid = new Types.ObjectId(itemId);
    const existing = (await ItemUomRepo.model
      .find({ itemId: itemOid })
      .lean()
      .exec()) as ItemUomLean[];
    const existingById = new Map(
      existing.map((d) => [String(d._id), d]),
    );
    const previousBase = existing.find((d) => d.isBase);
    const previousBaseUomId = previousBase
      ? String(previousBase.uomId)
      : null;

    const relatedInPayload = rows.filter(
      (r) => !r.isBase && r.conversionFactor != null,
    );
    if (relatedInPayload.length > 0 && !rows.some((r) => r.isBase)) {
      throw new Error("Exactly one base UOM is required");
    }

    // Cannot leave related UOMs without a base row in the same payload
    // (already enforced). Cannot remove base while related exist without
    // assigning a new base — also covered by exactly-one-base rule.

    const forRescale = factorsRelativeToPreviousBase(
      rows,
      existing,
      previousBaseUomId,
    );
    const rescaled = rescaleFactorsForNewBase(forRescale, previousBaseUomId);
    const factorByUom = new Map(
      rescaled.map((r) => [r.uomId, r.conversionFactor]),
    );

    const normalized = rows.map((row, index) => ({
      ...row,
      conversionFactor: row.isBase
        ? "1"
        : (factorByUom.get(row.uomId) ?? row.conversionFactor),
      sortOrder: row.sortOrder ?? index,
    }));

    const uomIds = normalized.map((r) => new Types.ObjectId(r.uomId));
    const found = await UomRepo.model
      .find({ _id: { $in: uomIds } })
      .lean()
      .exec();
    if (found.length !== uomIds.length) {
      throw new Error("One or more UOMs were not found");
    }

    const keepIds = new Set<string>();
    for (const row of normalized) {
      if (row.id && Types.ObjectId.isValid(row.id)) {
        const prev = existingById.get(row.id);
        if (prev && String(prev.itemId) === itemId) {
          keepIds.add(row.id);
        }
      }
    }

    const toDelete = existing
      .filter((d) => !keepIds.has(String(d._id)))
      .map((d) => String(d._id));

    if (toDelete.length > 0) {
      await ItemUomRepo.deleteMany({
        itemId: itemOid,
        _id: { $in: toDelete.map((id) => new Types.ObjectId(id)) },
      });
    }

    const results: ItemUomLean[] = [];
    for (const row of normalized) {
      const payload = {
        uomId: new Types.ObjectId(row.uomId),
        isBase: row.isBase,
        conversionFactor: row.isBase ? "1" : row.conversionFactor,
        sortOrder: row.sortOrder ?? 0,
      };

      if (row.id && keepIds.has(row.id)) {
        const updated = await ItemUomRepo.findOneAndUpdate(
          { _id: row.id, itemId: itemOid },
          { $set: payload },
        );
        if (updated) {
          results.push(updated as unknown as ItemUomLean);
          continue;
        }
      }

      const created = await ItemUomRepo.create({
        itemId: itemOid,
        ...payload,
      });
      results.push(created as unknown as ItemUomLean);
    }

    const baseRow = normalized.find((r) => r.isBase)!;
    await ItemRepo.findByIdAndUpdate(itemId, {
      $set: { baseUomId: new Types.ObjectId(baseRow.uomId) },
    });

    const meta = new Map(
      found.map((u) => [
        String(u._id),
        {
          symbol: u.symbol,
          name: u.name,
          formulas: defaultFormulasOr(u.formulas),
        },
      ]),
    );
    return results
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((doc) => toOut(doc, meta.get(String(doc.uomId))));
  }

  async deleteByItem(itemId: string): Promise<void> {
    if (!Types.ObjectId.isValid(itemId)) return;
    await ItemUomRepo.deleteMany({ itemId: new Types.ObjectId(itemId) });
  }
}

export const itemUomService = new ItemUomService();
