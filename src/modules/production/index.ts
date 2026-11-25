/**
 * Public contract of the production module (ADR-0001).
 * Other modules import from here only; everything else in this folder is private.
 * Routers are mounted from `src/index.ts` via their route files (RBAC category).
 */

export { allocatedQty } from "./production.planner";
export { productionService } from "./production.service";
export { assertProcessKept, heldQtyOnItem, orderLineKey } from "./stageFlow";
export {
  assertRealizationFeeWithinHandover,
  directToVendorTargets,
} from "./vendorWork";
export {
  countLiveOrdersForShopDrawingItem,
  LIVE_ORDER_FILTER,
  listProductionOrders,
  listValidReports,
  VALID_REPORT_FILTER,
  type ProductionOrderRefDto,
  type ProductionReportRefDto,
} from "./production.public";
export { productionForProject } from "./production.forProject";
export { productionForPurchasing } from "./production.forPurchasing";
