import { Types } from "mongoose";
import type {
  CreateItemCategoryDto,
  ItemCategoryOutDto,
  UpdateItemCategoryDto,
} from "../../dto/itemMaster.dto";
import {
  ItemCategoryRepo,
  type ItemCategoryInterface,
} from "../../models/itemCategory/itemCategory.model";
import { ItemRepo } from "../../models/item/item.model";

type ItemCategoryLean = ItemCategoryInterface & { _id: Types.ObjectId };

const NAME_COLLATION = { locale: "en", strength: 2 } as const;

function toOut(doc: ItemCategoryLean): ItemCategoryOutDto {
  return {
    id: String(doc._id),
    name: doc.name,
  };
}

export class ItemCategoryService {
  async list(): Promise<ItemCategoryOutDto[]> {
    const docs = await ItemCategoryRepo.model
      .find()
      .sort({ name: 1 })
      .lean()
      .exec();
    return docs.map((doc) => toOut(doc as ItemCategoryLean));
  }

  async getById(id: string): Promise<ItemCategoryOutDto | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await ItemCategoryRepo.model.findById(id).lean().exec();
    if (!doc) return null;
    return toOut(doc as ItemCategoryLean);
  }

  async assertExists(id: string): Promise<void> {
    const found = await this.getById(id);
    if (!found) throw new Error("Category not found");
  }

  private async assertUniqueName(
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await ItemCategoryRepo.model
      .findOne({ name })
      .collation(NAME_COLLATION)
      .lean()
      .exec();
    if (!existing) return;
    if (excludeId && String(existing._id) === excludeId) return;
    throw new Error(`Category "${name}" already exists`);
  }

  async create(input: CreateItemCategoryDto): Promise<ItemCategoryOutDto> {
    await this.assertUniqueName(input.name);
    const created = await ItemCategoryRepo.create({ name: input.name });
    const detail = await this.getById(String(created._id));
    if (!detail) throw new Error("Category created but not found");
    return detail;
  }

  async update(
    id: string,
    input: UpdateItemCategoryDto,
  ): Promise<ItemCategoryOutDto> {
    if (!Types.ObjectId.isValid(id)) throw new Error("Invalid category id");
    const existing = await ItemCategoryRepo.model.findById(id).lean().exec();
    if (!existing) throw new Error("Category not found");

    await this.assertUniqueName(input.name, id);

    const updated = await ItemCategoryRepo.findByIdAndUpdate(id, {
      $set: { name: input.name },
    });
    if (!updated) throw new Error("Category not found");
    const detail = await this.getById(id);
    if (!detail) throw new Error("Category not found");
    return detail;
  }

  /**
   * Deletes the category and pulls it from all items that referenced it.
   */
  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new Error("Category not found");
    const existing = await ItemCategoryRepo.model.findById(id).lean().exec();
    if (!existing) throw new Error("Category not found");

    const categoryObjectId = new Types.ObjectId(id);
    await ItemRepo.model
      .updateMany(
        { categoryIds: categoryObjectId },
        { $pull: { categoryIds: categoryObjectId } },
      )
      .exec();

    const deleted = await ItemCategoryRepo.deleteOne({ _id: id });
    if (!deleted) throw new Error("Category not found");
  }
}

export const itemCategoryService = new ItemCategoryService();
