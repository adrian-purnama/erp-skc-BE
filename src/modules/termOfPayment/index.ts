/**
 * Public contract of the termOfPayment module (ADR-0001).
 * Other modules import from here only; everything else in this folder is private.
 * Routers are mounted from `src/index.ts` via their route files (RBAC category).
 */

export {
  getTermOfPayment,
  listActiveTermsOfPayment,
  type TermOfPaymentRefDto,
} from "./termOfPayment.public";
