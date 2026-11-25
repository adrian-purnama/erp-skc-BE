/**
 * Public contract of the uom module (ADR-0001).
 * Other modules import from here only; everything else in this folder is private.
 * Routers are mounted from `src/index.ts` via their route files (RBAC category).
 */

export { uomService } from "./uom.service";
export { defaultFormulasOr, parseUomFormula } from "./uomFormula";
export {
  getUomsByIds,
  listActiveUoms,
  UOM_DEFAULT_DECIMALS,
  UOM_MAX_DECIMALS,
  type UomOptionDto,
  type UomRefDto,
} from "./uom.public";
