/**
 * Public contract of the appConfig module (ADR-0001).
 * Other modules import from here only; everything else in this folder is private.
 * Routers are mounted from `src/index.ts` via their route files (RBAC category).
 */

export { companyLetterhead, loadCompanyLogo } from "./AppConfig.public";
export { appConfigService } from "./AppConfig.service";
