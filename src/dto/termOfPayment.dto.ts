export type CreateTermOfPaymentDto = {
  termOfPayment: string;
};

export type UpdateTermOfPaymentDto = {
  termOfPayment?: string;
  isActive?: boolean;
};

export type TermOfPaymentOutDto = {
  id: string;
  termOfPayment: string;
  isActive: boolean;
};
