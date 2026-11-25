import { PHONE_TYPES, PhoneModel } from "../../models/phone.model";
import { createOwnerContactService } from "../ownerContact";

export const phoneService = createOwnerContactService({
  model: PhoneModel,
  valueField: "number",
  types: PHONE_TYPES,
  label: "Phone",
});
