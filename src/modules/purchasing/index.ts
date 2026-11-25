/**
 * Public contract of the purchasing module (ADR-0001).
 * Other modules import from here only; everything else in this folder is private.
 * Routers are mounted from `src/index.ts` via their route files (RBAC category).
 */

export {
  providePurchasingPorts,
  type ProductionForPurchasing,
  type SpkSnapshot,
} from "./purchasing.ports";
export { purchasingForProject } from "./purchasing.forProject";
export {
  countLivePurchasesForSpks,
  getPurchaseOrderLines,
  getPurchaseOrderNumbers,
  listSpkPurchaseOrders,
  realizedQtyByPoLine,
  type PurchaseOrderLineRefDto,
  type RealizedQtyDto,
  type SpkPurchaseOrderDto,
  type SpkPurchaseOrderLineDto,
} from "./purchasing.public";
