import Decimal from "decimal.js";
import { Types } from "mongoose";
import type {
  CreateUomDto,
  UpdateUomDto,
  UomOutDto,
} from "../../dto/uom.dto";
import {
  UOM_DEFAULT_DECIMALS,
  UomRepo,
  type UomInterface,
} from "../../models/uom.model";
import {
  formatDecimal,
  parsePositiveDecimal,
} from "../itemMaster/itemUomConvert";
import {
  defaultFormulasOr,
  evalUomFormula,
  parseUomFormula,
  type UomVar,
} from "./uomFormula";

type UomLean = UomInterface & { _id: Types.ObjectId };

const SYMBOL_COLLATION = { locale: "en", strength: 2 } as const;

function toOut(doc: UomLean): UomOutDto {
  return {
    id: String(doc._id),
    symbol: doc.symbol,
    category: doc.category,
    name: doc.name,
    formulas: defaultFormulasOr(doc.formulas),
    decimals: doc.decimals ?? UOM_DEFAULT_DECIMALS,
    isActive: doc.isActive !== false,
  };
}

export class UomService {
  /**
   * Pure snapshot calculator: formula + inputs → qty.
   * No DB / no UOM catalog lookup — safe for historical BOQ rows.
   */
  calculateQty(
    formula: string,
    inputs: Partial<Record<UomVar, string>>,
  ): string {
    const parsed = parseUomFormula(formula);
    const values: Partial<Record<UomVar, string>> = {};
    for (const name of parsed.variables) {
      const raw = inputs[name];
      if (raw === undefined || typeof raw !== "string" || !raw.trim()) {
        throw new Error(`${name} is required`);
      }
      values[name] = formatDecimal(
        parsePositiveDecimal(raw, name),
      );
    }
    const rawResult = evalUomFormula(parsed.expression, values);
    const qty = new Decimal(rawResult);
    if (!qty.isFinite() || qty.lte(0)) {
      throw new Error("Calculated quantity must be greater than 0");
    }
    return formatDecimal(qty);
  }

  async list(category?: string): Promise<UomOutDto[]> {
    const filter: Record<string, unknown> = {};
    if (category && category.trim()) {
      filter.category = category.trim();
    }
    const docs = await UomRepo.model
      .find(filter)
      .sort({ category: 1, symbol: 1 })
      .lean()
      .exec();
    return docs.map((doc) => toOut(doc as UomLean));
  }

  async getById(id: string): Promise<UomOutDto | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await UomRepo.model.findById(id).lean().exec();
    if (!doc) return null;
    return toOut(doc as UomLean);
  }

  private async assertUniqueSymbol(
    symbol: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await UomRepo.model
      .findOne({ symbol })
      .collation(SYMBOL_COLLATION)
      .lean()
      .exec();
    if (!existing) return;
    if (excludeId && String(existing._id) === excludeId) return;
    throw new Error(`UoM symbol "${symbol}" already exists`);
  }

  async create(input: CreateUomDto): Promise<UomOutDto> {
    await this.assertUniqueSymbol(input.symbol);
    const created = await UomRepo.create({
      symbol: input.symbol,
      category: input.category,
      name: input.name,
      formulas: input.formulas,
      decimals: input.decimals,
      isActive: true,
    });
    const detail = await this.getById(String(created._id));
    if (!detail) throw new Error("UoM created but not found");
    return detail;
  }

  async update(id: string, input: UpdateUomDto): Promise<UomOutDto> {
    if (!Types.ObjectId.isValid(id)) throw new Error("Invalid uom id");
    const existing = await UomRepo.model.findById(id).lean().exec();
    if (!existing) throw new Error("UoM not found");

    if (input.symbol !== undefined) {
      await this.assertUniqueSymbol(input.symbol, id);
    }

    const updated = await UomRepo.findByIdAndUpdate(
      id,
      {
        $set: {
          ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.formulas !== undefined ? { formulas: input.formulas } : {}),
          ...(input.decimals !== undefined ? { decimals: input.decimals } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      },
      { new: true },
    );
    if (!updated) throw new Error("UoM not found");

    const detail = await this.getById(id);
    if (!detail) throw new Error("UoM not found");
    return detail;
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new Error("Invalid uom id");
    const deleted = await UomRepo.deleteOne({ _id: id });
    if (!deleted) throw new Error("UoM not found");
  }
}

export const uomService = new UomService();
