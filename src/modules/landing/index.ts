/**
 * Public contract of the landing module (ADR-0001): website categories, posts
 * and their images. Nothing else imports it today; routers are mounted from
 * `src/index.ts` via their route files (RBAC category).
 */

export { landingService } from "./landing.service";
export type { PublicLandingDto } from "../../dto/landing.dto";
