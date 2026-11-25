import { EMAIL_TYPES, EmailModel } from "../../models/email.model";
import { createOwnerContactService } from "../ownerContact";

export const emailContactService = createOwnerContactService({
  model: EmailModel,
  valueField: "address",
  types: EMAIL_TYPES,
  label: "Email",
});
