import { logger } from "../../logger/logger";
import { UomRepo, type UomInterface } from "../../models/uom/uom.model";

const logSource = "modules/uom/uom.seed.ts";

type SeedRow = Pick<UomInterface, "symbol" | "category" | "name" | "formulas">;

const SEED_UOMS: SeedRow[] = [
  { symbol: "mm", category: "length", name: "Millimeter", formulas: ["v1"] },
  { symbol: "cm", category: "length", name: "Centimeter", formulas: ["v1"] },
  { symbol: "m", category: "length", name: "Meter", formulas: ["v1"] },
  { symbol: "km", category: "length", name: "Kilometer", formulas: ["v1"] },
  { symbol: "in", category: "length", name: "Inch", formulas: ["v1"] },
  { symbol: "ft", category: "length", name: "Feet", formulas: ["v1"] },
  {
    symbol: "cm2",
    category: "area",
    name: "Square centimeter",
    formulas: ["v1", "v1 * v2"],
  },
  {
    symbol: "m2",
    category: "area",
    name: "Square meter",
    formulas: ["v1", "v1 * v2"],
  },
  {
    symbol: "ha",
    category: "area",
    name: "Hectare",
    formulas: ["v1", "v1 * v2"],
  },
  {
    symbol: "cm3",
    category: "volume",
    name: "Cubic centimeter",
    formulas: ["v1", "v1 * v2 * v3"],
  },
  { symbol: "L", category: "volume", name: "Liter", formulas: ["v1"] },
  {
    symbol: "m3",
    category: "volume",
    name: "Cubic meter",
    formulas: ["v1", "v1 * v2 * v3"],
  },
  { symbol: "g", category: "weight", name: "Gram", formulas: ["v1"] },
  { symbol: "kg", category: "weight", name: "Kilogram", formulas: ["v1"] },
  { symbol: "ton", category: "weight", name: "Ton", formulas: ["v1"] },
  { symbol: "pcs", category: "count", name: "Pieces", formulas: ["v1"] },
  { symbol: "dozen", category: "count", name: "Dozen", formulas: ["v1"] },
  { symbol: "box", category: "count", name: "Box", formulas: ["v1"] },
];

export async function seedUoms(): Promise<void> {
  for (const row of SEED_UOMS) {
    await UomRepo.model
      .findOneAndUpdate(
        { symbol: row.symbol },
        {
          $set: {
            category: row.category,
            name: row.name,
            formulas: row.formulas,
          },
          $setOnInsert: { symbol: row.symbol },
        },
        {
          upsert: true,
          collation: { locale: "en", strength: 2 },
        },
      )
      .exec();
  }
  logger.info(`Seeded ${SEED_UOMS.length} UoM records`, logSource, "seedUoms");
}
