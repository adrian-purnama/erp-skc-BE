import type { EmailType } from "../models/email/email.model";
import type { PhoneType } from "../models/phone/phone.model";

export type VendorEmailInDto = {
  id?: string;
  address: string;
  type: EmailType;
  isPreferred?: boolean;
};

export type VendorPhoneInDto = {
  id?: string;
  number: string;
  type: PhoneType;
  isPreferred?: boolean;
};

export type CreateVendorDto = {
  name: string;
  address: string;
  npwp?: string;
  emails?: VendorEmailInDto[];
  phones?: VendorPhoneInDto[];
};

export type UpdateVendorDto = {
  name?: string;
  address?: string;
  npwp?: string;
  isActive?: boolean;
  emails?: VendorEmailInDto[];
  phones?: VendorPhoneInDto[];
};

export type VendorEmailOutDto = {
  id: string;
  address: string;
  type: EmailType;
  isPreferred: boolean;
};

export type VendorPhoneOutDto = {
  id: string;
  number: string;
  type: PhoneType;
  isPreferred: boolean;
};

export type VendorListItemOutDto = {
  id: string;
  name: string;
  address: string;
  npwp: string;
  isActive: boolean;
};

export type VendorDetailOutDto = VendorListItemOutDto & {
  emails: VendorEmailOutDto[];
  phones: VendorPhoneOutDto[];
};
