# Graph Report - backend  (2026-09-05)

## Corpus Check
- 97 files · ~26,461 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 666 nodes · 1600 edges · 24 communities (20 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.68)
- Token cost: 0 input · 0 output

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
- jsonOutputGuard.ts
- tsconfig.json
- ollamaClient.ts
- JobService
- OllamaClient
- widget.model.ts
- PUBLIC_CAPABILITIES

## God Nodes (most connected - your core abstractions)
1. `Logger` - 22 edges
2. `JobType` - 22 edges
3. `ArticleService` - 22 edges
4. `JobWorkerService` - 18 edges
5. `TopicModel` - 16 edges
6. `ArticleController` - 16 edges
7. `EntitlementService` - 16 edges
8. `ApiResponseDto` - 15 edges
9. `statusForMessage()` - 15 edges
10. `requireUserId()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `parseLanguageCode()` --calls--> `isValidTranslateLanguageCode()`  [EXTRACTED]
  src/utils/jobValidation.ts → src/constants/translategemmaLanguages.ts
- `JobOutDto` --references--> `JobResultInterface`  [EXTRACTED]
  src/dto/job.dto.ts → src/models/job/job.interface.ts
- `JobOutDto` --references--> `JobType`  [EXTRACTED]
  src/dto/job.dto.ts → src/models/job/job.interface.ts
- `CreatePlanDto` --references--> `JobType`  [EXTRACTED]
  src/dto/plan.dto.ts → src/models/job/job.interface.ts
- `PlanOutDto` --references--> `JobType`  [EXTRACTED]
  src/dto/plan.dto.ts → src/models/job/job.interface.ts

## Import Cycles
- None detected.

## Communities (24 total, 4 thin omitted)

### Community 0 - "article.service.ts"
Cohesion: 0.06
Nodes (65): jszip, jszip, ArticleDetailOutDto, ArticleOutDto, CreateArticleDto, ExportArticleOutDto, ImportArticleDto, TopicOutDto (+57 more)

### Community 1 - "index.ts"
Cohesion: 0.05
Nodes (34): connectDatabase(), EnvironmentProvider, EnvironmentProviderInterface, bootstrap(), createApp(), Logger, authenticateByToken(), AuthError (+26 more)

### Community 2 - "user.service.ts"
Cohesion: 0.09
Nodes (21): AdminUserOutDto, UpdateAdminUserDto, CreatePlanDto, PlanOutDto, UpdatePlanDto, UserPlanOutDto, PlanInterface, PlanModel (+13 more)

### Community 3 - "auth.service.ts"
Cohesion: 0.09
Nodes (18): LoginInDto, LoginOutDto, registerInDto, RegisterOutDto, ResetPasswordInDto, ResetPasswordOutDto, SendOtpInDto, Otpinterface (+10 more)

### Community 4 - "admin.controller.ts"
Cohesion: 0.09
Nodes (22): ApiResponseDto, requireAdmin(), JOB_TYPE_VALUES, AdminController, AppConfigPayload, adminController, router, upload (+14 more)

### Community 5 - "devDependencies"
Cohesion: 0.05
Nodes (38): author, description, devDependencies, @tsconfig/node22, tsx, @types/bcrypt, @types/cors, @types/express (+30 more)

### Community 6 - "apiKey.service.ts"
Cohesion: 0.14
Nodes (19): ApiKeyOutDto, CreateApiKeyDto, CreateApiKeyOutDto, UpdateApiKeyDto, ApiKeyInterface, ApiKeyStatusInterface, ApiKeyModel, apiKeySchema (+11 more)

### Community 7 - "article.controller.ts"
Cohesion: 0.18
Nodes (17): ArticleController, multerFiles(), requireUserId(), statusForMessage(), EntitlementController, parseCapability(), parseApiKeyId(), parseApiKeyIdQuery() (+9 more)

### Community 8 - "AppConfig.service.ts"
Cohesion: 0.11
Nodes (16): AppConfigInterface, AppConfigModel, appConfigSchema, AppConfigService, MailService, deletePublicFile(), deletePublicFileIfExists(), findPublicFile() (+8 more)

### Community 9 - "entitlement.service.ts"
Cohesion: 0.12
Nodes (12): CapabilitiesOutDto, HasCapabilityOutDto, ApiKeyAuthContext, authenticateByApiKey(), requireApiKey(), JobType, EntitlementService, jobController (+4 more)

### Community 10 - "jobValidation.ts"
Cohesion: 0.12
Nodes (23): JobController, estimateBase64DecodedBytes(), isPlainObject(), MESSAGE_ROLES, normalizeBase64Input(), OCR_PROMPTS, OcrJobParsedInput, parseAdminRunJobWorkerDto() (+15 more)

### Community 11 - "job.dto.ts"
Cohesion: 0.13
Nodes (24): AdminRunJobWorkerDto, AdminRunJobWorkerOutDto, CreateChatJobDto, CreateChatJobOutDto, CreateOcrJobDto, CreateOcrJobOutDto, CreateTranslateJobDto, CreateTranslateJobOutDto (+16 more)

### Community 12 - "dependencies"
Cohesion: 0.08
Nodes (25): @arcanada/output-guard, bcrypt, cors, dotenv, express, @getbrevo/brevo, jsonwebtoken, mongoose (+17 more)

### Community 13 - "JobWorkerService"
Cohesion: 0.24
Nodes (6): JobResultInterface, JobDocument, JobWorkerService, resolveModel(), buildJsonOutputSystemPrompt(), OllamaMessage

### Community 14 - "modelRegistry.ts"
Cohesion: 0.15
Nodes (13): CapabilitiesController, capabilitiesController, router, CapabilitiesOutDto, CapabilitiesService, INTERNAL_ROLES, InternalRole, isPublicCapability() (+5 more)

### Community 15 - "jobWorkerService.ts"
Cohesion: 0.22
Nodes (10): getTranslateLanguageName(), isValidTranslateLanguageCode(), nameByCode, TRANSLATEGEMMA_LANGUAGE_CODES, TRANSLATEGEMMA_LANGUAGES, TranslateLanguage, DEFAULT_MAX_CONCURRENT_NON_PRIORITY_JOBS, parseTranslateJobInput() (+2 more)

### Community 16 - "jsonOutputGuard.ts"
Cohesion: 0.26
Nodes (11): createJsonResultTemplateSchemaValidator(), extractJsonFromModelText(), isPlainObject(), JSON_OUTPUT_STRUCTURE_ERROR, JSON_TYPE_NAMES, JsonOutputGuardResult, JsonOutputValidationError, JsonResultTemplateSchemaValidator (+3 more)

### Community 17 - "tsconfig.json"
Cohesion: 0.18
Nodes (10): dist, **/*.ts, @tsconfig/node22/tsconfig.json, compilerOptions, forceConsistentCasingInFileNames, outDir, rootDir, exclude (+2 more)

### Community 18 - "ollamaClient.ts"
Cohesion: 0.22
Nodes (9): DEFAULTS, OllamaChatOptions, OllamaChatRequest, OllamaChatResponse, OllamaChatResponseMessage, OllamaClientConfig, OllamaGenerateResponse, OllamaMessageRole (+1 more)

## Knowledge Gaps
- **115 isolated node(s):** `name`, `version`, `description`, `dev`, `start` (+110 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report**    run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `article.service.ts`, `devDependencies`?**
  _High betweenness centrality (0.173) - this node is a cross-community bridge._
- **Why does `jszip` connect `article.service.ts` to `dependencies`?**
  _High betweenness centrality (0.172) - this node is a cross-community bridge._
- **Why does `ApiResponseDto` connect `admin.controller.ts` to `index.ts`, `user.service.ts`, `auth.service.ts`, `apiKey.service.ts`, `article.controller.ts`, `AppConfig.service.ts`, `entitlement.service.ts`, `job.dto.ts`, `modelRegistry.ts`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _115 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `article.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0593505039193729 - nodes in this community are weakly interconnected._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05328218243819267 - nodes in this community are weakly interconnected._
- **Should `user.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08597285067873303 - nodes in this community are weakly interconnected._