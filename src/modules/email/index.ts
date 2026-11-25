/**
 * Public contract of the email module (ADR-0001).
 * Other modules import from here only; everything else in this folder is private.
 * Routers are mounted from `src/index.ts` via their route files (RBAC category).
 */

export { emailService } from "./email.service";
export { emailContactService } from "./emailContact.service";
