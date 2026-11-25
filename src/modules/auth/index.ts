/**
 * Public contract of the auth (user) module (ADR-0001).
 * Other modules import from here only; everything else in this folder is private.
 * Routers are mounted from `src/index.ts` via their route files (RBAC category).
 */

export {
  assertAssignableUser,
  getUserDisplayNames,
  hasSuperAdmin,
  getUserRef,
  listAssignableUsers,
  userEmailsById,
  userRefsById,
  type UserRefDto,
  type UserRefLite,
} from "./user.public";
