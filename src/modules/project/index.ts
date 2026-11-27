/**
 * Public contract of the project module (ADR-0001).
 * Other modules import from here only; everything else in this folder is private.
 * Routers are mounted from `src/index.ts` via their route files (RBAC category).
 */

export { fileVersionsById, liveCurrentFiles } from "./projectCurrentFiles";
export {
  collectSourceLines,
  isLabourLine,
  labourExecutor,
  labourRole,
  rabCostFactor,
  rabMoney,
  rabLineKey,
  rabRowsForPurchasing,
  resolveRabTarget,
  roundRabQty,
  type BoqLike,
  type RabUomPlan,
} from "./projectRab.planner";
export { projectRabService } from "./projectRab.service";
export { filterCountedBoqs, sumLineTotals } from "./projectRabChange.planner";
export { projectRabChangeService } from "./projectRabChange.service";
export { loadRabUomPlan } from "./projectRabUomPlan";
export { shopDrawingItemLabel } from "./projectShared";
export { loadShopDrawingSpecs } from "./projectShopDrawingSpec";
export { sameAsVersionFor } from "./versionedProjectFile.service";
export {
  assertProjectsExist,
  listFileScopesMissingCurrent,
  listNonCurrentFileVersionIds,
  listUnreferencedProjectBlobIds,
  purgeShrinkDeletedBlobs,
  purgeUnreferencedProjectBlobs,
  shrinkFileVersion,
  type FileScopeMissingCurrent,
  type ProjectFileKind,
  type ShrinkFileVersionResult,
} from "./projectFileMaintenance";
export {
  getProductionFileNames,
  getProjectRab,
  getProjectRef,
  getProjectRefs,
  getShopDrawingItemRef,
  getShopDrawingFileNames,
  getShopDrawingItemRefs,
  listCurrentItemFiles,
  listLiveShopDrawingItems,
  listProjectRabs,
  listShopDrawingBoqs,
  markProjectReleasedToProduction,
  markProjectWon,
  type ItemFileRefDto,
  type ProjectRabSnapshot,
  type ProjectRefDto,
  type ShopDrawingBoqSnapshot,
  type ShopDrawingItemRefDto,
} from "./project.public";
export {
  stagesOf,
  trackPercentExact,
  type StageLine,
  type StageRole,
} from "./projectStages.planner";
export {
  provideProjectPorts,
  type ContractQuotationFigures,
  type HeldLabourLine,
  type ProductionForProject,
  type ProductionSummaryInputs,
  type PurchasingForProject,
  type QuotationForProject,
  type ScheduleActuals,
} from "./project.ports";
export { allocateRealizationCost } from "./projectSummary.planner";
