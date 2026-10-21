import { EMAIL_TYPES, EmailModel } from "../../models/email/email.model";
import { createOwnerContactService } from "../ownerContact/ownerContact.service";

export const emailService = createOwnerContactService({
  model: EmailModel,
  valueField: "address",
  types: EMAIL_TYPES,
  label: "Email",
});
