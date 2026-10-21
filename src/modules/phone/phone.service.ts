import { PHONE_TYPES, PhoneModel } from "../../models/phone/phone.model";
import { createOwnerContactService } from "../ownerContact/ownerContact.service";

export const phoneService = createOwnerContactService({
  model: PhoneModel,
  valueField: "number",
  types: PHONE_TYPES,
  label: "Phone",
});
