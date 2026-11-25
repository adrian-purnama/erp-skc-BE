/**
 * Public contract of the quotation module (ADR-0001).
 * Other modules import from here only; everything else in this folder is private.
 * Routers are mounted from `src/index.ts` via their route files (RBAC category).
 */

export {
  computeTotals,
  quotationCharges,
  type QuotationCharge,
  type QuotationDiscountType,
} from "./quotation.planner";
export { quotationForProject } from "./quotation.forProject";
export { getWonQuotationRef, type WonQuotationRefDto } from "./quotation.public";
