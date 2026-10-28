import type { UomRoundingMode } from "../models/uom/uom.model";

export type CreateUomDto = {
  symbol: string;
  category: string;
  name: string;
  formulas: string[];
  decimals: number;
  rounding: UomRoundingMode;
};

export type UpdateUomDto = {
  symbol?: string;
  category?: string;
  name?: string;
  formulas?: string[];
  decimals?: number;
  rounding?: UomRoundingMode;
  isActive?: boolean;
};

export type UomOutDto = {
  id: string;
  symbol: string;
  category: string;
  name: string;
  formulas: string[];
  decimals: number;
  rounding: UomRoundingMode;
  isActive: boolean;
};
