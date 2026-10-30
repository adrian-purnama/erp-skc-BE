export type CreateUomDto = {
  symbol: string;
  category: string;
  name: string;
  formulas: string[];
  decimals: number;
};

export type UpdateUomDto = {
  symbol?: string;
  category?: string;
  name?: string;
  formulas?: string[];
  decimals?: number;
  isActive?: boolean;
};

export type UomOutDto = {
  id: string;
  symbol: string;
  category: string;
  name: string;
  formulas: string[];
  decimals: number;
  isActive: boolean;
};
