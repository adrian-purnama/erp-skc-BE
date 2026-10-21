# Graph Report - backend  (2026-10-20)

## Corpus Check
- 156 files · ~49,148 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1111 nodes · 2986 edges · 41 communities (40 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0798a0b7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- article.service.ts
- index.ts
- user.service.ts
- auth.service.ts
- admin.controller.ts
- devDependencies
- apiKey.service.ts
- article.controller.ts
- AppConfig.service.ts
- entitlement.service.ts
- jobValidation.ts
- job.dto.ts
- dependencies
- JobWorkerService
- modelRegistry.ts
- jobWorkerService.ts
- itemMaster.ts
- tsconfig.json
- projectShopDrawing.service.ts
- projectShopDrawingBoq.service.ts
- projectShopDrawingBoq.ts
- projectShopDrawingBoq.model.ts
- assertProjectExists
- projectShopDrawingBoq.dto.ts
- projectShared.ts
- articleBucket.ts
- RoleModel
- itemTarif.service.ts
- env.ts
- ProjectShopDrawingBoqService
- widgetValidation.ts
- OtpService
- project.controller.ts
- plan.service.ts
- projectShopDrawingBoq.test.ts
- seqCounter.model.ts
- topicValidation.ts
- scripts
- package.json
- chatAnalytics.service.ts
- AppConfig.route.ts

## God Nodes (most connected - your core abstractions)
1. `ok()` - 98 edges
2. `fail()` - 96 edges
3. `parseRouteId()` - 62 edges
4. `ProjectController` - 36 edges
5. `assertProjectExists()` - 36 edges
6. `ItemMasterService` - 31 edges
7. `UserModel` - 26 edges
8. `asRecord()` - 24 edges
9. `RoleModel` - 19 edges
10. `VersionedProjectFileService` - 18 edges

## Surprising Connections (you probably didn't know these)
- `parseLineList()` --indirect_call--> `line()`  [INFERRED]
  src/validation/projectShopDrawingBoq.ts → src/validation/projectShopDrawingBoq.test.ts
- `purgeBlobIfUnreferenced()` --calls--> `deleteFileIfExists()`  [EXTRACTED]
  src/modules/admin/shrinkDb/shrinkDb.service.ts → src/buckets/gridfs.ts
- `purgeBlobIfUnreferenced()` --calls--> `findFile()`  [EXTRACTED]
  src/modules/admin/shrinkDb/shrinkDb.service.ts → src/buckets/gridfs.ts
- `unmatchedBlobIds()` --calls--> `listFileIds()`  [EXTRACTED]
  src/modules/admin/shrinkDb/shrinkDb.service.ts → src/buckets/gridfs.ts
- `recomputeAllRoles()` --references--> `PermissionModel`  [EXTRACTED]
  src/core/permissions/sync.ts → src/core/permissions/permission.model.ts

## Import Cycles
- None detected.

## Communities (41 total, 1 thin omitted)

### Community 0 - "article.service.ts"
Cohesion: 0.17
Nodes (10): withTx(), FolderOutDto, ItemOutDto, FolderRepo, ItemRepo, assertActiveVendors(), ItemMasterService, toFolderOut() (+2 more)

### Community 1 - "index.ts"
Cohesion: 0.11
Nodes (19): HandlerMeta, MetaHandler, ApiResponseDto, MetaHandler, readBearer(), requireUser(), authController, router (+11 more)

### Community 2 - "user.service.ts"
Cohesion: 0.06
Nodes (50): CreateCustomerDto, CustomerDetailOutDto, CustomerEmailInDto, CustomerEmailOutDto, CustomerListItemOutDto, CustomerPhoneInDto, CustomerPhoneOutDto, UpdateCustomerDto (+42 more)

### Community 3 - "auth.service.ts"
Cohesion: 0.14
Nodes (12): LoginInDto, LoginOutDto, registerInDto, RegisterOutDto, ResetPasswordInDto, ResetPasswordOutDto, SendOtpInDto, AuthService (+4 more)

### Community 4 - "admin.controller.ts"
Cohesion: 0.08
Nodes (42): CreateProjectDto, ProjectCustomerContactDto, ProjectDetailOutDto, ProjectListItemOutDto, UpdateProjectDto, customerContactSchema, PROJECT_CLOSE_REASONS, PROJECT_GENDERS (+34 more)

### Community 5 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, @tsconfig/node22, tsx, @types/bcrypt, @types/cors, @types/express, @types/jsonwebtoken, @types/multer (+11 more)

### Community 6 - "apiKey.service.ts"
Cohesion: 0.08
Nodes (39): ItemUomInDto, ItemUomOutDto, CreateUomDto, UomOutDto, UpdateUomDto, ItemUomInterface, ItemUomRepo, itemUomSchema (+31 more)

### Community 7 - "article.controller.ts"
Cohesion: 0.17
Nodes (15): CreateProjectCalendarEventDto, ProjectCalendarAgendaOutDto, ProjectCalendarEventOutDto, UpdateProjectCalendarEventDto, ProjectCalendarEventInterface, ProjectCalendarEventRepo, projectCalendarEventSchema, ProjectCalendarEventType (+7 more)

### Community 8 - "AppConfig.service.ts"
Cohesion: 0.51
Nodes (8): assertDecimalShape(), convertByFactors(), convertItemQty(), formatDecimal(), ItemUomFactorRow, parsePositiveDecimal(), parseQtyDecimal(), rescaleFactorsForNewBase()

### Community 9 - "entitlement.service.ts"
Cohesion: 0.09
Nodes (38): listAuditedCollections(), PurgeOrphanBlobsInDto, PurgeOrphanBlobsOutDto, ShrinkDbStatusOutDto, ShrinkDbStep, ShrinkLiveStatus, ShrinkOrphansOutDto, StartShrinkDbInDto (+30 more)

### Community 10 - "jobValidation.ts"
Cohesion: 0.15
Nodes (20): deleteFileIfExists(), AuditedRepo, als, AuditStore, ProjectLooseFileOutDto, ProjectLooseFilesByKindOutDto, PROJECT_LOOSE_FILE_KINDS, ProjectLooseFileInterface (+12 more)

### Community 11 - "job.dto.ts"
Cohesion: 0.10
Nodes (26): actorBy(), AuditAction, AuditDoc, AuditedCollectionInfo, getAuditModel(), LeanDoc, registry, writeAudit() (+18 more)

### Community 12 - "dependencies"
Cohesion: 0.12
Nodes (17): bcrypt, cors, decimal.js, express, @getbrevo/brevo, jsonwebtoken, mongoose, multer (+9 more)

### Community 13 - "JobWorkerService"
Cohesion: 0.18
Nodes (20): categoryFromFilePath(), createRouter(), getMountRecords(), isRecordedRouter(), joinPaths(), MountRecord, mountRouter(), mounts (+12 more)

### Community 14 - "modelRegistry.ts"
Cohesion: 0.23
Nodes (12): assertReplicaSet(), initAuditCollections(), syncPermissions(), connectDatabase(), bootstrap(), createApp(), format(), location() (+4 more)

### Community 15 - "jobWorkerService.ts"
Cohesion: 0.11
Nodes (22): auditedModel(), ChildrenFolderNode, ChildrenItemNode, ChildrenNode, ConvertItemQtyDto, ConvertItemQtyOutDto, CreateFolderDto, CreateItemDto (+14 more)

### Community 16 - "itemMaster.ts"
Cohesion: 0.18
Nodes (21): asRecord(), allocateUniqueFolderCode(), pad4(), parseConvertItemQtyDto(), parseCreateFolderDto(), parseCreateItemDto(), parseFolderCode(), parseMoveFolderDto() (+13 more)

### Community 17 - "tsconfig.json"
Cohesion: 0.18
Nodes (10): compilerOptions, forceConsistentCasingInFileNames, outDir, rootDir, exclude, extends, include, dist (+2 more)

### Community 18 - "projectShopDrawing.service.ts"
Cohesion: 0.14
Nodes (16): ProjectShopDrawingFileOutDto, ProjectShopDrawingItemOutDto, ProjectShopDrawingItemInterface, ProjectShopDrawingItemRepo, projectShopDrawingItemSchema, assertLiveItem(), files, LeanItem (+8 more)

### Community 19 - "projectShopDrawingBoq.service.ts"
Cohesion: 0.12
Nodes (19): ProjectShopDrawingBoqBaseLineOutDto, ProjectShopDrawingBoqLineOutDto, ProjectShopDrawingBoqOutDto, UpsertShopDrawingBoqIn, ProjectShopDrawingBoqBaseLine, ProjectShopDrawingBoqInterface, ProjectShopDrawingBoqLine, ShopDrawingBoqMountingType (+11 more)

### Community 20 - "projectShopDrawingBoq.ts"
Cohesion: 0.18
Nodes (21): ShopDrawingBoqAssemblyIn, ShopDrawingBoqAssemblyInputIn, ShopDrawingBoqLineInputsIn, ShopDrawingBoqPartIn, SHOP_DRAWING_BOQ_FINISH_SIDES, SHOP_DRAWING_BOQ_MOUNTING_TYPES, ShopDrawingBoqFinishSide, parseAssemblies() (+13 more)

### Community 21 - "projectShopDrawingBoq.model.ts"
Cohesion: 0.09
Nodes (21): ProjectShopDrawingBoqAssembly, ProjectShopDrawingBoqAssemblyInput, projectShopDrawingBoqAssemblyInputSchema, projectShopDrawingBoqAssemblySchema, projectShopDrawingBoqBaseLineSchema, ProjectShopDrawingBoqFinishing, projectShopDrawingBoqFinishingSchema, ProjectShopDrawingBoqLighting (+13 more)

### Community 23 - "projectShopDrawingBoq.dto.ts"
Cohesion: 0.11
Nodes (16): ProjectShopDrawingBoqAssemblyInputOutDto, ProjectShopDrawingBoqAssemblyOutDto, ProjectShopDrawingBoqFinishingOutDto, ProjectShopDrawingBoqItemSummaryOutDto, ProjectShopDrawingBoqLightingOutDto, ProjectShopDrawingBoqLineInputsOutDto, ProjectShopDrawingBoqMainOutDto, ProjectShopDrawingBoqMountingOutDto (+8 more)

### Community 24 - "projectShared.ts"
Cohesion: 0.22
Nodes (14): Bucket, buckets, deleteFile(), findFile(), getBucket(), GridFsFileResult, listFileIds(), openDownload() (+6 more)

### Community 25 - "articleBucket.ts"
Cohesion: 0.06
Nodes (49): PermissionInterface, PermissionModel, PermissionRoute, permissionRouteSchema, permissionSchema, PermissionStatus, all(), byKey (+41 more)

### Community 26 - "RoleModel"
Cohesion: 0.23
Nodes (10): requirePermission(), cache, CACHE_TTL_MS_FOR_TESTS, CacheEntry, getUserPermissions(), invalidateAll(), recomputeAllRoles(), seedRoles() (+2 more)

### Community 27 - "itemTarif.service.ts"
Cohesion: 0.26
Nodes (8): ItemTarifInDto, ItemTarifOutDto, ItemTarifInterface, ItemTarifRepo, itemTarifSchema, ItemTarifLean, ItemTarifService, toOut()

### Community 28 - "env.ts"
Cohesion: 0.22
Nodes (6): env, authenticateByToken(), AuthError, AccessTokenPayload, signAccessToken(), verifyAccessToken()

### Community 29 - "ProjectShopDrawingBoqService"
Cohesion: 0.27
Nodes (6): ProjectShopDrawingBoqMaterialOutDto, ShopDrawingBoqBaseLineIn, ShopDrawingBoqLineIn, ProjectShopDrawingBoqRepo, ProjectShopDrawingBoqService, line()

### Community 30 - "widgetValidation.ts"
Cohesion: 0.17
Nodes (13): ProjectDocumentOutDto, ProjectDocumentsByKindOutDto, PROJECT_DOCUMENT_KINDS, ProjectDocumentInterface, ProjectDocumentKind, ProjectDocumentRepo, projectDocumentSchema, files (+5 more)

### Community 31 - "OtpService"
Cohesion: 0.28
Nodes (4): Otpinterface, OtpModel, otpSchema, OtpService

### Community 32 - "project.controller.ts"
Cohesion: 0.47
Nodes (7): PROJECT_CALENDAR_EVENT_TYPES, assertRangeDates(), parseCreateProjectCalendarEventDto(), parseDate(), parseNearDays(), parseType(), parseUpdateProjectCalendarEventDto()

### Community 33 - "plan.service.ts"
Cohesion: 0.25
Nodes (7): adminController, auditController, permissionController, roleController, router, shrinkDbController, upload

### Community 34 - "projectShopDrawingBoq.test.ts"
Cohesion: 0.22
Nodes (7): collectAssemblyConsumeWarnings(), itemId, itemId2, shopDrawingFileId, shopDrawingItemId, uomId, uomId2

### Community 35 - "seqCounter.model.ts"
Cohesion: 0.40
Nodes (3): ItemSeqCounterModel, ProjectSeqCounterModel, SeqCounterInterface

### Community 42 - "topicValidation.ts"
Cohesion: 0.12
Nodes (16): AdminUserDetailOutDto, AdminUserOutDto, UpdateAdminUserDto, AppConfigInterface, AppConfigModel, appConfigSchema, UserInterface, UserModel (+8 more)

### Community 45 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, format, format:check, lint, lint:fix, start (+2 more)

### Community 47 - "package.json"
Cohesion: 0.25
Nodes (7): author, description, keywords, license, name, type, version

### Community 52 - "chatAnalytics.service.ts"
Cohesion: 0.05
Nodes (22): fail(), ok(), AdminController, PermissionController, ShrinkDbController, AuthController, CustomerController, ItemMasterController (+14 more)

### Community 89 - "AppConfig.route.ts"
Cohesion: 0.25
Nodes (5): publicRoute(), AppConfigController, appConfigController, router, router

## Knowledge Gaps
- **209 isolated node(s):** `name`, `version`, `description`, `dev`, `start` (+204 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fail()` connect `chatAnalytics.service.ts` to `AppConfig.route.ts`, `project.controller.ts`, `auth.service.ts`, `entitlement.service.ts`, `job.dto.ts`, `itemMaster.ts`, `articleBucket.ts`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `ok()` connect `chatAnalytics.service.ts` to `project.controller.ts`, `auth.service.ts`, `entitlement.service.ts`, `job.dto.ts`, `itemMaster.ts`, `articleBucket.ts`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Why does `assertProjectExists()` connect `assertProjectExists` to `admin.controller.ts`, `article.controller.ts`, `jobValidation.ts`, `projectShopDrawing.service.ts`, `projectShopDrawingBoq.service.ts`, `projectShopDrawingBoq.dto.ts`, `projectShared.ts`, `ProjectShopDrawingBoqService`, `widgetValidation.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _209 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11330049261083744 - nodes in this community are weakly interconnected._
- **Should `user.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05673274094326726 - nodes in this community are weakly interconnected._
- **Should `auth.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14245014245014245 - nodes in this community are weakly interconnected._