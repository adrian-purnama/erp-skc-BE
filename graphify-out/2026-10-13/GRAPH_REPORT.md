# Graph Report - backend  (2026-10-13)

## Corpus Check
- 132 files · ~33,071 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 791 nodes · 1961 edges · 25 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `90b9d585`
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
- tsconfig.json
- articleBucket.ts
- widgetValidation.ts
- plan.service.ts
- topicValidation.ts
- scripts
- package.json
- chatAnalytics.service.ts
- AppConfig.route.ts

## God Nodes (most connected - your core abstractions)
1. `parseRouteId()` - 36 edges
2. `ItemMasterService` - 28 edges
3. `UserModel` - 24 edges
4. `RoleModel` - 19 edges
5. `withTx()` - 17 edges
6. `ProjectController` - 16 edges
7. `AppConfigService` - 14 edges
8. `ItemMasterController` - 14 edges
9. `ApiResponseDto` - 13 edges
10. `RoleService` - 12 edges

## Surprising Connections (you probably didn't know these)
- `deleteDocument()` --calls--> `withTx()`  [EXTRACTED]
  src/modules/project/deleteDocument.service.ts → src/core/audit/context.ts
- `syncPermissions()` --references--> `PermissionModel`  [EXTRACTED]
  src/core/permissions/sync.ts → src/core/permissions/permission.model.ts
- `computeEffective()` --calls--> `implied()`  [EXTRACTED]
  src/modules/admin/roles/role.service.ts → src/core/permissions/registry.ts
- `createApp()` --calls--> `mountRouter()`  [EXTRACTED]
  src/index.ts → src/core/permissions/routing.ts
- `scanRoutes()` --calls--> `getMountRecords()`  [EXTRACTED]
  src/core/permissions/scan.ts → src/core/permissions/routing.ts

## Import Cycles
- None detected.

## Communities (25 total, 0 thin omitted)

### Community 0 - "article.service.ts"
Cohesion: 0.07
Nodes (49): withTx(), ChildrenFolderNode, ChildrenItemNode, ChildrenNode, ConvertItemQtyDto, ConvertItemQtyOutDto, CreateFolderDto, CreateItemDto (+41 more)

### Community 1 - "index.ts"
Cohesion: 0.11
Nodes (23): HandlerMeta, categoryFromFilePath(), createRouter(), getMountRecords(), joinPaths(), mountRouter(), mounts, resetMountRecordsForTests() (+15 more)

### Community 2 - "user.service.ts"
Cohesion: 0.07
Nodes (39): CreateCustomerDto, CustomerDetailOutDto, CustomerEmailInDto, CustomerEmailOutDto, CustomerListItemOutDto, CustomerPhoneInDto, CustomerPhoneOutDto, UpdateCustomerDto (+31 more)

### Community 3 - "auth.service.ts"
Cohesion: 0.07
Nodes (22): LoginInDto, LoginOutDto, registerInDto, RegisterOutDto, ResetPasswordInDto, ResetPasswordOutDto, SendOtpInDto, env (+14 more)

### Community 4 - "admin.controller.ts"
Cohesion: 0.10
Nodes (34): CreateProjectDto, ProjectCustomerContactDto, ProjectDetailOutDto, ProjectListItemOutDto, UpdateProjectDto, PROJECT_CLOSE_REASONS, PROJECT_GENDERS, PROJECT_LOSE_REASONS (+26 more)

### Community 5 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, @tsconfig/node22, tsx, @types/bcrypt, @types/cors, @types/express, @types/jsonwebtoken, @types/multer (+11 more)

### Community 6 - "apiKey.service.ts"
Cohesion: 0.12
Nodes (17): CreateUomDto, UomOutDto, UpdateUomDto, UomInterface, UomRepo, uomSchema, UomController, SEED_UOMS (+9 more)

### Community 7 - "article.controller.ts"
Cohesion: 0.15
Nodes (21): CreateProjectCalendarEventDto, ProjectCalendarAgendaOutDto, ProjectCalendarEventOutDto, UpdateProjectCalendarEventDto, PROJECT_CALENDAR_EVENT_TYPES, ProjectCalendarEventInterface, ProjectCalendarEventType, ProjectCalendarEventRepo (+13 more)

### Community 8 - "AppConfig.service.ts"
Cohesion: 0.14
Nodes (22): ItemUomInterface, ItemUomRepo, itemUomSchema, factorsRelativeToPreviousBase(), ItemUomLean, ItemUomService, toOut(), validateRowShape() (+14 more)

### Community 9 - "entitlement.service.ts"
Cohesion: 0.17
Nodes (17): all(), byKey, get(), has(), implied(), MODULE_PERMS, requireLabels(), ScanViolation (+9 more)

### Community 10 - "jobValidation.ts"
Cohesion: 0.18
Nodes (12): ProjectSeqCounterInterface, projectSeqCounterSchema, allocateProjectNumber(), createMemorySeqAllocator(), formatProjectNumber(), jakartaPartsFormatter, jakartaYmd, mongoSeqAllocator (+4 more)

### Community 11 - "job.dto.ts"
Cohesion: 0.15
Nodes (11): actorBy(), AuditAction, AuditDoc, auditedModel(), AuditedRepo, AuditedRepoOpts, LeanDoc, registry (+3 more)

### Community 12 - "dependencies"
Cohesion: 0.12
Nodes (17): bcrypt, cors, decimal.js, express, @getbrevo/brevo, jsonwebtoken, mongoose, multer (+9 more)

### Community 13 - "JobWorkerService"
Cohesion: 0.21
Nodes (14): isRecordedRouter(), MountRecord, expressMajorVersion(), getAppStack(), HEALTH_ALLOWLIST, isRouterHandle(), joinPath(), LayerLike (+6 more)

### Community 14 - "modelRegistry.ts"
Cohesion: 0.25
Nodes (11): assertReplicaSet(), initAuditCollections(), seedRoles(), syncPermissions(), connectDatabase(), bootstrap(), createApp(), format() (+3 more)

### Community 15 - "jobWorkerService.ts"
Cohesion: 0.25
Nodes (6): PermissionInterface, PermissionRoute, permissionRouteSchema, permissionSchema, PermissionStatus, ScannedRoute

### Community 17 - "tsconfig.json"
Cohesion: 0.18
Nodes (10): compilerOptions, forceConsistentCasingInFileNames, outDir, rootDir, exclude, extends, include, dist (+2 more)

### Community 25 - "articleBucket.ts"
Cohesion: 0.08
Nodes (36): PermissionModel, requirePermission(), cache, CACHE_TTL_MS_FOR_TESTS, CacheEntry, getUserPermissions(), invalidateAll(), invalidateUser() (+28 more)

### Community 30 - "widgetValidation.ts"
Cohesion: 0.09
Nodes (39): Bucket, buckets, deleteFile(), deleteFileIfExists(), findFile(), getBucket(), GridFsFileResult, openDownload() (+31 more)

### Community 33 - "plan.service.ts"
Cohesion: 0.15
Nodes (11): getLastScan(), ScanResult, adminController, permissionController, roleController, router, upload, PermissionController (+3 more)

### Community 42 - "topicValidation.ts"
Cohesion: 0.08
Nodes (16): AdminUserDetailOutDto, AdminUserOutDto, UpdateAdminUserDto, AppConfigInterface, AppConfigModel, appConfigSchema, AdminController, AppConfigPayload (+8 more)

### Community 45 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, format, format:check, lint, lint:fix, start (+2 more)

### Community 47 - "package.json"
Cohesion: 0.25
Nodes (7): author, description, keywords, license, name, type, version

### Community 52 - "chatAnalytics.service.ts"
Cohesion: 0.09
Nodes (5): CustomerController, ItemMasterController, ProjectController, parseParam(), parseRouteId()

### Community 89 - "AppConfig.route.ts"
Cohesion: 0.21
Nodes (9): MetaHandler, publicRoute(), ApiResponseDto, readBearer(), requireAuth(), AppConfigController, appConfigController, router (+1 more)

## Knowledge Gaps
- **129 isolated node(s):** `name`, `version`, `description`, `dev`, `start` (+124 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `parseRouteId()` connect `chatAnalytics.service.ts` to `article.service.ts`, `user.service.ts`, `admin.controller.ts`, `apiKey.service.ts`, `topicValidation.ts`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Why does `ApiResponseDto` connect `AppConfig.route.ts` to `article.service.ts`, `plan.service.ts`, `user.service.ts`, `auth.service.ts`, `admin.controller.ts`, `apiKey.service.ts`, `topicValidation.ts`, `articleBucket.ts`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `withTx()` connect `article.service.ts` to `job.dto.ts`, `admin.controller.ts`, `widgetValidation.ts`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _129 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `article.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06538987688098495 - nodes in this community are weakly interconnected._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10967741935483871 - nodes in this community are weakly interconnected._
- **Should `user.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.074034902168165 - nodes in this community are weakly interconnected._