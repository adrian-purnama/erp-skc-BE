# Backend audit — 2026-11-24

Scope: `backend/` (Express 5 + TypeScript 7 + Mongoose 9). ~54k lines in `src/` across 297 files, 35 test files.
Audit only — no source files were changed. Lint/dup tools were run from a scratch directory, not installed into the repo.

---

## 1. Executive summary

- **The code is in better shape than most Express codebases.** Strict mode is already on, `tsc` is clean, there is exactly 1 `any`, no `@ts-ignore`, inputs are parsed by hand-written parsers, regex searches are escaped, and multi-document writes use transactions (`withTx`).
- **The one serious risk is in auth:** the password-reset OTP can be brute-forced. It's 6 digits, there's no attempt limit and no rate limiting, so an attacker can take over any account (F-01, F-02).
- **Dependencies need a bump:** 7 advisories (1 critical, 3 high). `npm audit fix` clears 6 of them without breaking changes (F-03).
- **Duplication is moderate (4.9%) and clusters in a few places.** Customer and Vendor are identical after the name is swapped. The 6 PDF builders each re-implement the same header/table/footer. Realization and Vendor Invoice share a lot of code.
- **The rest is tidiness:** 165 "not found" errors come back as HTTP 400, the 404/500 handlers leave `data: null` out of the envelope, there's no lint config or CI, there's no `.env.example`, and 50 functions are over 80 lines (mostly PDF/XLSX builders).

### Health score per area (1 = poor, 5 = excellent)

| Area | Score | Notes |
| --- | --- | --- |
| TypeScript quality | **5** | strict on, 1 `any`, 21 `as unknown as`, 40 non-null `!` |
| Express structure | **4** | clean layering, `handle()` helper; 404 vs 400 and envelope gaps |
| Validation | **4** | parsers everywhere except auth (inline, no password policy) |
| Mongoose / data | **4** | `.lean()` used 416×, transactions used; missing unique index on `User.email`, unpaginated lists |
| Security | **2** | OTP brute force, no rate limit, no helmet, vulnerable deps, user enumeration |
| Tidiness / duplication | **3** | 4.9% duplicated lines, a few 200–340-line functions |
| Tooling / guardrails | **2** | no ESLint config, no CI, no `.env.example`, tests need a real `.env` |

---

## Phase 0 — Architecture (≤10 lines)

1. **Layers:** Route → Controller → Service → Model (no repository layer). Feature modules live in `src/modules/<name>/`. Pure "planner" modules (`*.planner.ts`) hold the domain math and are the main unit-test surface.
2. **Entry point:** `src/index.ts`. `bootstrap()` runs connect → replica-set check → audit collections → shrinkDb recovery → route scan → RBAC permission sync → seed → listen.
3. **Config:** `src/core/env.ts` is a typed object and fails fast on missing required vars at import time.
4. **Auth:** JWT bearer via `requireUser` (`middleware/requireUser.ts`) → `requirePermission({key})`. RBAC is enforced at startup by a route scanner (`core/permissions/scan.ts`) that rejects routes with no auth meta.
5. **Errors:** controllers wrap the work in `handle()` / `fail()` (`dto/httpResponse.ts:36-77`). `fail()` hides driver errors (500) and passes domain `Error.message` through (400). Express 5 forwards async rejections to the global handler in `index.ts:161`.
6. **Validation:** hand-written `parse*` functions in `src/validation/` (no zod/joi).
7. **Audit trail:** an `auditedModel` wrapper plus AsyncLocalStorage (`core/audit/`); it requires a Mongo replica set.

**Missing / notable**

| Item | Status |
| --- | --- |
| `strict` | ✅ on (inherited from `@tsconfig/node22`), so `--strict` adds nothing |
| Tests | ✅ 35 `node:test` files, but `npm test` uses `--env-file=.env` and needs real secrets to run (`package.json:10`) |
| Lint config | ❌ none (no ESLint/Prettier) |
| `.env.example` | ❌ missing (`.gitignore` already whitelists it) |
| CI | ❌ none found |
| `README.md` | ⚠️ one heading only |
| `engines` field | ❌ none, although the base tsconfig targets Node 22 |

---

## Phase 1 — Automated checks

| Tool | Result |
| --- | --- |
| `tsc --noEmit` | **0 errors** |
| `tsc --strict` | **0 new** (already strict). With the extra flags `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnused*` and `noImplicitReturns`: **78 errors**. 44 of them come from `exactOptionalPropertyTypes` alone, and only **11** from `noUncheckedIndexedAccess` |
| ESLint (`typescript-eslint` recommended) | **7 errors, 10 warnings**. 10 are `no-console` (logger + script), 4 are unused vars, 2 are `require()` in a test, 1 is a useless escape |
| knip | **1 unused file**, **90 unused exports**, **102 unused exported types** (mostly "exported but only used locally"; low value) |
| jscpd (min 5 lines, tests excluded) | **174 clones**, **1,975 duplicated lines (4.88%)** |
| madge | **1 circular import:** `dto/projectRab.dto.ts:7` ↔ `dto/purchasing.dto.ts:1` (type-only, so harmless at runtime) |
| npm audit | **7 vulns:** 1 critical (`proxy-addr`), 3 high (`body-parser`, `mongoose`, `multer`), 3 moderate (`qs`, `uuid` via `exceljs`) |

**Top 10 automated findings**

1. `npm audit`: `proxy-addr` (critical, IP spoofing in trust-subnet matching), `multer` (2× DoS), `body-parser` (DoS), `mongoose` (high). All are fixable with a plain `npm audit fix`.
2. `uuid` <11.1.1 comes in through `exceljs`. The only fix is `--force`, which downgrades exceljs (a breaking change), so leave it for now: the vulnerable code path (`buf` argument) isn't used by us.
3. jscpd: `validation/customer.ts` ↔ `validation/vendor.ts` share 119 lines; the files are identical apart from the name.
4. jscpd: `modules/customer/customer.service.ts` ↔ `modules/vendor/vendor.service.ts` are 100% identical after the name swap (`diff` is empty).
5. jscpd: the PDF builders (`quotation.pdf.ts`, `purchaseOrder.pdf.ts`, `purchasingDoc.pdf.ts`, `production.pdf.ts`, `productionHandover.pdf.ts`, `materialDispatch.pdf.ts`) account for ~1,000 duplicated lines between them.
6. jscpd: `purchaseRealization.service.ts` ↔ `vendorInvoice.service.ts` share 97 lines.
7. jscpd: `models/projectDocument.model.ts:46-115` ↔ `models/projectShopDrawingDocument.model.ts:37-106` share a 70-line schema.
8. tsc (extra flags) `TS2339`: `projectNumber.ts:74,77` reads `.nextSeq` off a `findOneAndUpdate` result whose inferred type is `ModifyResult`. It works today, but only because of overload choice. Worth a typed `{ new: true }` / `includeResultMetadata: false`.
9. tsc `TS7030`: `middleware/requireUser.ts:18` and `media/media.route.ts:13` have mixed return/no-return paths (fine at runtime, but `noImplicitReturns` would flag them).
10. knip: `src/scripts/resetItemLevelSpks.ts` isn't referenced anywhere. It's a one-off migration and a candidate to delete or document.

---

## 2. Findings table

Severity reflects impact if exploited or left alone. Rows marked *(judgment)* are opinions, not bugs.

| ID | Severity | Area | File:line | Problem | Suggested fix | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| F-01 | **Critical** | Security | `modules/otp/otp.service.ts:12,36-49`; `modules/auth/auth.service.ts:200-222` | The password-reset OTP is 6 digits, made with `Math.random()`, valid for 5 minutes, and has **no attempt counter**. A wrong guess doesn't invalidate it. Since there's also no rate limit (F-02), anyone can brute-force `POST /auth/reset-password` for any email and take over the account. The same applies to register. | Use `crypto.randomInt(0, 1e6)`. Add an `attempts` field to `Otp` and delete the OTP after 5 failures. Better still for reset: a 32-byte `randomBytes` token instead of an OTP embedded in a link (`encodeResetToken`, `auth.service.ts:39`). | M |
| F-02 | **High** | Security | `src/index.ts:38-46`; `modules/auth/auth.route.ts:22-25` | There's no rate limiting anywhere, which allows OTP brute force, password spraying on `/auth/login`, and OTP email flooding via `/auth/otp` (Brevo cost and abuse). | Add `express-rate-limit` on `/auth/*`, keyed by IP and by email. `trust proxy` is already set (`index.ts:40`). | S |
| F-03 | **High** | Dependencies | `package.json` | 1 critical and 3 high advisories (`proxy-addr`, `multer`, `body-parser`, `mongoose`). | Run `npm audit fix` (non-breaking) and re-run the tests. Leave `uuid`/exceljs alone. | S |
| F-04 | **High** | Data | `models/user.model.ts:23-26` | `User.email` has **no unique index**. Two concurrent `register` calls can create duplicate accounts (the check at `auth.service.ts:115` isn't atomic), and every login does a collection scan. | Add `unique: true` (after confirming there are no existing duplicates) and catch `E11000` → "Email already registered". | S |
| F-05 | Medium | Security | `modules/appConfig/AppConfig.service.ts:47-51,114`; `modules/auth/auth.service.ts:129-143` | `firstRegister` is an in-memory flag. Two simultaneous first registrations can **both** get `super_admin`. *(Low likelihood, since it's only exposed on a fresh install.)* | Make the first-admin claim atomic, e.g. a unique-key insert in `AppConfig` or `findOneAndUpdate` on a flag. | S |
| F-06 | Medium | Security | `modules/auth/auth.service.ts:66-73,207-210` | **User enumeration:** `/auth/otp` returns "No account found" / "Email already registered", and `/auth/reset-password` returns "No account found". | Return a generic "If the email exists, we sent a code". Register can keep its message (judgment call: UX vs privacy). | S |
| F-07 | Medium | Security | `modules/auth/auth.service.ts:218-219`; `utils/jwt.ts:20` | A password reset doesn't invalidate existing JWTs, which live up to 30 days. A stolen token survives the reset. | Add `passwordChangedAt` (or `tokenVersion`) to `User` and reject tokens with `iat` < `passwordChangedAt` in `authenticateByToken`. | M |
| F-08 | Medium | Validation | `modules/auth/auth.controller.ts:36-56`, `199-205` (service) | There's no password policy: any non-empty string is accepted on register, reset and admin create. Auth is also the only module that parses inline instead of through `validation/`. | Add `validation/auth.ts` with `parseRegisterDto` / `parseLoginDto` / `parseResetPasswordDto` and a minimum length of 8. | S |
| F-09 | Medium | Security | `src/index.ts:38-46` | No `helmet`. Express sends `X-Powered-By`, and there's no HSTS or nosniff. | `app.use(helmet())`, or at least `app.disable("x-powered-by")`. | S |
| F-10 | Medium | HTTP | `dto/httpResponse.ts:36-55` (+165 `throw new Error("… not found")`) | Every domain error becomes **400**, including "not found" (165 throw sites). Clients can't tell a 404 from a validation error. | Add `NotFoundError` / `ConflictError` classes (like the existing `RoleConflictError`) and map them in `fail()`. Migrate the throw sites gradually. | M |
| F-11 | Low | HTTP | `src/index.ts:148-166` | The global 404/500 responses leave out `data: null`, which breaks the `ApiResponseDto` contract the frontend relies on. | Add `data: null` and `satisfies ApiResponseDto`. | S |
| F-12 | Low | Data | `modules/customer/customer.service.ts:23-38`, `vendor/vendor.service.ts:23-38`, `project/project.service.ts:155-170`, `admin/roles/role.service.ts:104` (≈40 `list*` methods, 18 `.limit()` total) | List endpoints return whole collections with no pagination. That's fine at current data sizes. *(Judgment call: only matters as data grows.)* | Add a cursor/limit only to lists that will grow (projects, items, POs). | M |
| F-13 | Low | Data | `models/otp.model.ts:19-21`; `models/purchaseCharge.model.ts`; `models/permission.model.ts`; `models/appconfig.model.ts` | The `Otp.email` lookup has no index; 4 models have no `timestamps`. | Add `{ email: 1 }` to `Otp`, and `timestamps` where an audit date is useful (`purchaseCharge`). | S |
| F-14 | Low | Infra | `core/database.ts:1-22`; `src/index.ts:185` | There's no graceful shutdown (`SIGTERM` → `server.close` → `mongoose.disconnect`). In-flight transactions get cut on redeploy. `database.ts` is also unformatted and calls `logger.info` without `source`/`method` (`:13`). | Add a shutdown handler and tidy the file. | S |
| F-15 | Low | Auth | `modules/auth/auth.service.ts:177-190` | Login issues a token to **blocked** users. `requireUser` then rejects them with 403, but the login says "success". `hashedPassword!` (`:182`) assumes the field exists. | Check `isBlocked` in `login`. | S |
| F-16 | Low | Types | `dto/projectRab.dto.ts:7` ↔ `dto/purchasing.dto.ts:1` | A circular import (type-only). | Move the shared types (`ProjectRabUserRefOutDto`, `RealizationCharge*Dto`) into `dto/shared.dto.ts`. | S |
| F-17 | Low | Types | `itemTarif.service.ts:122,131`, `itemUom.service.ts:265,274`, `projectCalendar.service.ts:72,125`, `versionedProjectFile.service.ts:111-368` (21 total) | `as unknown as Lean*` after `create()` / `findOneAndUpdate()`. The casts hide drift between document and lean types. | Use `doc.toObject()` or `.lean<T>()` on the query. Where unavoidable, centralise the cast in one helper. | M |
| F-18 | Low | Tidiness | `core/permissions/sync.ts:9`, `admin/roles/role.service.ts:2`, `project/projectRabExport.service.ts:18`, `project/projectRabExport.planner.ts:16` | Unused imports/vars and a useless regex escape (from ESLint). | Delete them. | S |
| F-19 | Low | Tidiness | `src/scripts/resetItemLevelSpks.ts` | A one-off migration script that nothing references. | Delete it, or add an npm script with a comment. | S |
| F-20 | Low | Tooling | `package.json:10` | `npm test` requires a real `.env` (`--env-file=.env`), so tests can't run in CI. Most tests are pure planners. | Use `--env-file-if-exists=.env` (Node ≥22.9) or a `test.env` with dummy values. | S |
| F-21 | Low *(judgment)* | Structure | 50 functions >80 lines; worst: `projectRabExport.service.ts:562` `buildFormalWorkbook` (340), `quotation.pdf.ts:41` (272), `projectRabChange.service.ts:906` `toDetail` (260), `quotation.xlsx.ts:42` (259), `itemBulk.service.ts:247` `importBuffer` (221) | These are long, mostly linear document builders. Their length is a readability cost, not a bug. | Split along the document's sections (header / lines / totals / footer). This falls out naturally from D-2 below. | L |
| F-22 | Low *(judgment)* | Structure | `production.service.ts` (1,563), `purchaseOrder.service.ts` (1,676), `projectRabChange.service.ts` (1,235) | These are very large service files. They are already partly split into planners. | Only split when you next touch them (YAGNI). | — |

**Checked and fine (no finding)**

- `any` is used once, there's no `@ts-ignore`/`eslint-disable`, and `console.*` appears only in the logger.
- No `Model.create(req.body)` or `findByIdAndUpdate(id, req.body)` anywhere. All writes go through parsers.
- Every `$regex` built from user input is escaped (`utils/shared.ts` `escapeRegex`; `purchasePayment.service.ts:329` inlines the same escape).
- `req.params` go through `parseRouteId` and `req.query` through `readQuery` / `queryBool`.
- `hashedPassword` is never returned; admin and profile go through mappers.
- The public quotation link uses `randomBytes(32)` (`quotation.access.ts:5`), and the public media route only serves the `public` GridFS bucket.
- Multi-document writes use `withTx` (18 files).
- Every multer instance sets `fileSize` (6/6).
- CORS is restricted to `env.frontendUrl`.
- Async style is consistently `async/await`.

---

## 3. Duplication hotspots

| # | Group | Evidence | Proposed shared abstraction |
| --- | --- | --- | --- |
| D-1 | **Customer ≡ Vendor** | `customer.service.ts` vs `vendor.service.ts`: `diff` is empty after the name swap (145 lines each). Same for `validation/customer.ts` vs `vendor.ts` (`17-137`), `models/customer.model.ts:13-39` vs `vendor.model.ts:13-39`, and controllers/routes (76/51 lines each). | One **counterparty directory** module parameterised by model and DTO: `createCounterpartyService(Model)` plus a shared `parseCounterpartyDto`. *(Judgment: keep them separate if you expect them to diverge, e.g. vendor bank accounts. Today they are identical.)* |
| D-2 | **PDF builders** | `quotation.pdf.ts` (239 dup lines), `purchaseOrder.pdf.ts` (224), `purchasingDoc.pdf.ts` (200), `production.pdf.ts` (171), `productionHandover.pdf.ts` (117), `materialDispatch.pdf.ts` (105). For example `production.pdf.ts:114-199` ≈ `quotation.pdf.ts:51-167`, and `purchaseOrder.pdf.ts:144-264` ≈ `purchasingDoc.pdf.ts:118-224`. | A small **document layout** module (`core/pdf/`) with `drawLetterhead`, `drawMetaBlock`, `drawTable(columns, rows)`, `drawSignatures`, `drawQrFooter`. Each builder becomes a declarative description. This also shrinks the F-21 functions. |
| D-3 | **Realization ↔ Vendor Invoice** | `purchaseRealization.service.ts` ↔ `vendorInvoice.service.ts` (97 lines across 11 clones, e.g. `:51-65`↔`:39-53`, `:368-379`↔`:454-465`, `:484-495`↔`:420-431`). `models/purchaseRealization.model.ts` ↔ `vendorInvoice.model.ts` (56 lines). Their controllers also overlap with `purchasePayment.controller.ts` (35 lines). | Extract the shared **charge lines + money totals** schema and the load/authorise/assert-status steps into `purchasing/purchaseDocShared.ts`. *(Judgment: check against `docs/plans/vendor-invoices.md` first. The split may be intentional.)* |
| D-4 | **Versioned project files** | `models/projectDocument.model.ts:16-115` ↔ `projectShopDrawingDocument.model.ts:6-106` (90 lines) ↔ `projectLooseFile.model.ts` (40). | A shared `versionedFileSchemaFields` object or `buildVersionedFileSchema()`, matching the existing `versionedProjectFile.service.ts`. |
| D-5 | **Material dispatch ↔ handover** | `materialDispatch.service.ts` ↔ `productionHandover.service.ts` (40 lines) | A shared status-transition helper. Small win; only if touched. |
| D-6 | **Controller boilerplate** | 63 `try {` blocks in controllers that `handle()` would replace. `auth.controller.ts` alone has 9, and `vendor`, `customer`, `production` have 6 each. | Convert them to the existing `handle()` helper. No new abstraction needed. |

---

## 4. Quick wins (< 30 min each)

1. `npm audit fix` → re-run `npm test` + `tsc` (F-03).
2. Add `express-rate-limit` on `/auth/otp`, `/auth/login`, `/auth/reset-password`, `/auth/register` (F-02).
3. Switch to `crypto.randomInt` and add an OTP attempt counter (the core of F-01).
4. `unique: true` on `User.email`, after checking for duplicates in the DB (F-04).
5. `helmet()` or `app.disable("x-powered-by")` (F-09).
6. Add `data: null` to the 404/500 handlers (F-11).
7. Check `isBlocked` in `login` (F-15).
8. Delete the unused imports/vars from the ESLint output (F-18).
9. Add `.env.example` listing `MONGODB_URL`, `FRONTEND_URL`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `JWT_SECRET`, `PORT`, `BUILD`, `PUBLIC_API_URL`, `RBAC_SCAN_STRICT`, `AUDIT_REQUIRE_REPLICA_SET`, `ITEM_MASTER_MAX_FOLDER_DEPTH` (from `core/env.ts`).
10. Make `npm test` work without `.env` (F-20).
11. Add `Otp` `{ email: 1 }` index (F-13).

---

## 5. Recommended fix order (small, separately committable PRs)

| PR | Contents | Findings | Risk |
| --- | --- | --- | --- |
| **1. Auth hardening** | OTP via `crypto.randomInt` + attempt counter, rate limit on `/auth/*`, generic enumeration-safe messages, `isBlocked` on login, `validation/auth.ts` with password min length | F-01, F-02, F-06, F-08, F-15 | Low; frontend copy for the reset/otp messages may need a tweak |
| **2. Dependency bump** | `npm audit fix` | F-03 | Low; run the full test suite |
| **3. User email uniqueness + atomic first admin** | unique index, E11000 mapping, atomic first-admin claim | F-04, F-05 | Medium; needs a duplicate check on prod data before deploy |
| **4. Session revocation** | `passwordChangedAt` / `tokenVersion` | F-07 | Low |
| **5. HTTP hygiene** | helmet, 404/500 envelope, graceful shutdown, `database.ts` tidy | F-09, F-11, F-14 | Low |
| **6. Error taxonomy** | `NotFoundError` / `ConflictError` mapped in `fail()`; migrate the 165 throw sites module by module | F-10 | Medium; frontend may branch on status codes |
| **7. Tooling baseline** | ESLint flat config, `.env.example`, test env fix, delete dead code, fix the DTO cycle | F-16, F-18, F-19, F-20 | None |
| **8. Counterparty dedupe** | merge Customer/Vendor internals behind one module | D-1 | Low |
| **9. PDF layout module** | `core/pdf/` primitives; migrate one builder per commit | D-2, F-21 | Medium; needs a visual check of each PDF |
| **10. Purchasing doc sharing / versioned-file schema** | D-3, D-4 | — | Medium; only after re-reading the vendor-invoice plan |

PRs 1–5 are worth doing now. PRs 6–10 are refactors to schedule as you next touch those areas.

---

## 6. Guardrails to prevent regression

- **ESLint** (`eslint.config.mjs`, flat config) with `typescript-eslint` `recommended` and these rules:
  - `@typescript-eslint/no-explicit-any: error`
  - `no-console: error` (allow it in `core/logger.ts`)
  - `@typescript-eslint/no-non-null-assertion: warn`
  - `no-restricted-syntax` banning `Math.random` in `src/` outside tests
  - `no-restricted-imports` banning `Router` from express (enforce `createRouter`)
  - Later: `recommended-type-checked` with `no-floating-promises`
- **TS flags** (cheap to adopt): `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` (≈7 fixes), `noUncheckedIndexedAccess` (11 fixes), `noFallthroughCasesInSwitch`. Skip `exactOptionalPropertyTypes` for now (44 errors, mostly noise against Mongoose types).
- **Pre-commit** (`husky` + `lint-staged`): `eslint --fix` and `prettier` on staged files.
- **CI** (GitHub Actions on PR): `npm ci` → `tsc --noEmit` → `eslint .` → `npm test` → `npx madge --circular src` (fail on any cycle) → `npm audit --audit-level=high` → `npx jscpd src --threshold 5` (fail if duplication grows past today's 4.9%).
- **Dependabot / Renovate** for weekly dependency PRs.
- **Startup checks:** the RBAC scanner already fails on unauthenticated routes. Keep `RBAC_SCAN_STRICT=true` in production.
