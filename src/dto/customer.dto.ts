import type { EmailType } from "../models/email/email.model";
import type { PhoneType } from "../models/phone/phone.model";

export type CustomerEmailInDto = {
  id?: string;
  address: string;
  type: EmailType;
  isPreferred?: boolean;
};

export type CustomerPhoneInDto = {
  id?: string;
  number: string;
  type: PhoneType;
  isPreferred?: boolean;
};

export type CreateCustomerDto = {
  name: string;
  address: string;
  npwp?: string;
  emails?: CustomerEmailInDto[];
  phones?: CustomerPhoneInDto[];
};

export type UpdateCustomerDto = {
  name?: string;
  address?: string;
  npwp?: string;
  isActive?: boolean;
  emails?: CustomerEmailInDto[];
  phones?: CustomerPhoneInDto[];
};

export type CustomerEmailOutDto = {
  id: string;
  address: string;
  type: EmailType;
  isPreferred: boolean;
};

export type CustomerPhoneOutDto = {
  id: string;
  number: string;
  type: PhoneType;
  isPreferred: boolean;
};

export type CustomerListItemOutDto = {
  id: string;
  name: string;
  address: string;
  npwp: string;
  isActive: boolean;
};

export type CustomerDetailOutDto = CustomerListItemOutDto & {
  emails: CustomerEmailOutDto[];
  phones: CustomerPhoneOutDto[];
};
