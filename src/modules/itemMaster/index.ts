/**
 * Public contract of the itemMaster module (ADR-0001).
 * Other modules import from here only; everything else in this folder is private.
 * Routers are mounted from `src/index.ts` via their route files (RBAC category).
 */

export { folderPathUp } from "./folderPath";
export { itemMasterService } from "./itemMaster.service";
export {
  labourItemIds,
  loadItemMeta,
  type ItemMeta,
  type UomMeta,
} from "./itemMeta";
export { itemTarifService } from "./itemTarif.service";
export { itemUomService } from "./itemUom.service";
export {
  assertItemUomsBelong,
  getItemFolderPaths,
  getItemRefs,
  getItemUomRows,
  type ItemRefDto,
  type ItemUomRowDto,
} from "./itemMaster.public";
