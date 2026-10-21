import { Types } from "mongoose";
import type {
  ItemTarifInDto,
  ItemTarifOutDto,
} from "../../dto/itemMaster.dto";
import {
  ItemTarifRepo,
  type ItemTarifInterface,
} from "../../models/itemTarif/itemTarif.model";
type ItemTarifLean = ItemTarifInterface & { _id: Types.ObjectId };

function toOut(doc: ItemTarifLean): ItemTarifOutDto {
  return {
    id: String(doc._id),
    itemId: String(doc.itemId),
    effectiveDate: doc.effectiveDate,
    amount: doc.amount,
  };
}

export class ItemTarifService {
  async listByItem(itemId: string): Promise<ItemTarifOutDto[]> {
    if (!Types.ObjectId.isValid(itemId)) return [];
    const docs = await ItemTarifRepo.model
      .find({ itemId })
      .sort({ effectiveDate: -1 })
      .lean()
      .exec();
    return docs.map((doc) => toOut(doc as ItemTarifLean));
  }

  async resolveAsOf(
    itemId: string,
    asOfYmd: string,
  ): Promise<ItemTarifOutDto | null> {
    if (!Types.ObjectId.isValid(itemId)) return null;
    const doc = await ItemTarifRepo.model
      .findOne({
        itemId: new Types.ObjectId(itemId),
        effectiveDate: { $lte: asOfYmd },
      })
      .sort({ effectiveDate: -1 })
      .lean()
      .exec();
    if (!doc) return null;
    return toOut(doc as ItemTarifLean);
  }

  async replaceForItem(
    itemId: string,
    rows: ItemTarifInDto[],
  ): Promise<ItemTarifOutDto[]> {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new Error("Item not found");
    }

    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.effectiveDate)) {
        throw new Error("Duplicate effectiveDate on item tarif");
      }
      seen.add(row.effectiveDate);
    }

    const itemOid = new Types.ObjectId(itemId);
    const existing = (await ItemTarifRepo.model
      .find({ itemId: itemOid })
      .lean()
      .exec()) as ItemTarifLean[];
    const existingById = new Map(
      existing.map((d) => [String(d._id), d]),
    );

    const keepIds = new Set<string>();
    for (const row of rows) {
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
      await ItemTarifRepo.deleteMany({
        itemId: itemOid,
        _id: { $in: toDelete.map((id) => new Types.ObjectId(id)) },
      });
    }

    const results: ItemTarifLean[] = [];
    for (const row of rows) {
      const payload = {
        effectiveDate: row.effectiveDate,
        amount: row.amount,
      };

      if (row.id && keepIds.has(row.id)) {
        const updated = await ItemTarifRepo.findOneAndUpdate(
          { _id: row.id, itemId: itemOid },
          { $set: payload },
        );
        if (updated) {
          results.push(updated as unknown as ItemTarifLean);
          continue;
        }
      }

      const created = await ItemTarifRepo.create({
        itemId: itemOid,
        ...payload,
      });
      results.push(created as unknown as ItemTarifLean);
    }

    return results
      .map(toOut)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  }

  async deleteByItem(itemId: string): Promise<void> {
    if (!Types.ObjectId.isValid(itemId)) return;
    await ItemTarifRepo.deleteMany({ itemId: new Types.ObjectId(itemId) });
  }
}

export const itemTarifService = new ItemTarifService();
