export type CreateUomDto = {
  symbol: string;
  category: string;
  name: string;
  formulas: string[];
};

export type UpdateUomDto = {
  symbol?: string;
  category?: string;
  name?: string;
  formulas?: string[];
  isActive?: boolean;
};

export type UomOutDto = {
  id: string;
  symbol: string;
  category: string;
  name: string;
  formulas: string[];
  isActive: boolean;
};
