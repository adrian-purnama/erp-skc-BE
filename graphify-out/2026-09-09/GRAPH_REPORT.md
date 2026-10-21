# Graph Report - backend  (2026-09-09)

## Corpus Check
- 151 files · ~48,376 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1189 nodes · 3084 edges · 56 communities (45 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.5)
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
- deepseekClient.ts
- WidgetService
- articleBucket.ts
- widget.service.ts
- widget.controller.ts
- message.interface.ts
- agent.graph.ts
- widgetValidation.ts
- agent.service.ts
- mcp.interface.ts
- plan.service.ts
- agent.controller.ts
- articleMarkdown.ts
- job.dto.ts
- mail.service.ts
- createLlmProvider.ts
- logger.ts
- AdminService
- .chunkArticle
- topicValidation.ts
- UserModel
- agent.memory.ts
- scripts
- AuthController
- package.json
- topic.model.ts
- agent.state.ts
- mcpTool.model.ts
- chatOrDefault
- express
- mongoose
- @qdrant/js-client-rest
- @langchain/core

## God Nodes (most connected - your core abstractions)
1. `TopicModel` - 38 edges
2. `ArticleService` - 31 edges
3. `parseApiKeyId()` - 29 edges
4. `EntitlementService` - 24 edges
5. `parseContentToBlocks()` - 23 edges
6. `ArticleModel` - 22 edges
7. `JobType` - 20 edges
8. `ApiResponseDto` - 19 edges
9. `parseParam()` - 19 edges
10. `ArticleController` - 18 edges

## Surprising Connections (you probably didn't know these)
- `parseImportArticleDto()` --calls--> `parseApiKeyId()`  [EXTRACTED]
  src/utils/articleValidation.ts → src/utils/apiKeyValidation.ts
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

## Communities (56 total, 11 thin omitted)

### Community 0 - "article.service.ts"
Cohesion: 0.18
Nodes (11): ArticleDetailOutDto, ArticleOutDto, CreateArticleDto, TopicOutDto, ArticleModel, TopicModel, ArticleService, computeSyncStatus() (+3 more)

### Community 1 - "index.ts"
Cohesion: 0.07
Nodes (34): connectDatabase(), bootstrap(), createApp(), logger, requireApiKey, readBearer(), requireAuth(), requireUser (+26 more)

### Community 2 - "user.service.ts"
Cohesion: 0.19
Nodes (10): AdminUserOutDto, UpdateAdminUserDto, UserPlanOutDto, UserController, PopulatedUserDoc, toAdminUserOutDto(), toUserPlanOutDto(), UserPlanDoc (+2 more)

### Community 3 - "auth.service.ts"
Cohesion: 0.19
Nodes (12): LoginInDto, LoginOutDto, registerInDto, RegisterOutDto, ResetPasswordInDto, ResetPasswordOutDto, SendOtpInDto, UserModel (+4 more)

### Community 4 - "admin.controller.ts"
Cohesion: 0.31
Nodes (10): requireUserId(), SnippetController, statusForMessage(), parseApiKeyIdQuery(), parseBooleanField(), parseContent(), parseCreateSnippetDto(), parseSnippetRouteId() (+2 more)

### Community 5 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, @tsconfig/node22, tsx, @types/bcrypt, @types/cors, @types/express, @types/jsonwebtoken, @types/multer (+11 more)

### Community 6 - "apiKey.service.ts"
Cohesion: 0.07
Nodes (27): ApiKeyOutDto, CreateApiKeyDto, CreateApiKeyOutDto, UpdateApiKeyDto, CapabilitiesOutDto, ApiKeyAuthContext, authenticateByApiKey(), ApiKeyInterface (+19 more)

### Community 7 - "article.controller.ts"
Cohesion: 0.22
Nodes (13): ArticleController, multerFiles(), requireUserId(), statusForMessage(), parseApiKeyIdQuery(), parseArticleRouteId(), parseCreateArticleDto(), parseDescription() (+5 more)

### Community 8 - "AppConfig.service.ts"
Cohesion: 0.21
Nodes (4): AppConfigInterface, AppConfigModel, appConfigSchema, AppConfigService

### Community 9 - "entitlement.service.ts"
Cohesion: 0.06
Nodes (57): extFromFilename(), imageMarkdownRef(), ParsedMarkdownArticle, ParsedMarkdownTopic, parseTopicBody(), serializeArticleMarkdown(), serializeTopicContent(), applyVarBindings() (+49 more)

### Community 10 - "jobValidation.ts"
Cohesion: 0.11
Nodes (25): isValidTranslateLanguageCode(), JobController, estimateBase64DecodedBytes(), isPlainObject(), MESSAGE_ROLES, normalizeBase64Input(), OCR_PROMPTS, OcrJobParsedInput (+17 more)

### Community 11 - "job.dto.ts"
Cohesion: 0.12
Nodes (23): AdminRunJobWorkerDto, AdminRunJobWorkerOutDto, CreateChatJobDto, CreateJobOutDto, CreateOcrJobDto, CreateTranslateJobDto, JobOutDto, TranslateLanguageOutDto (+15 more)

### Community 12 - "dependencies"
Cohesion: 0.10
Nodes (21): cors, express, @getbrevo/brevo, jsonwebtoken, @langchain/langgraph, @langchain/textsplitters, @modelcontextprotocol/client, multer (+13 more)

### Community 13 - "JobWorkerService"
Cohesion: 0.26
Nodes (5): JobResultInterface, JobDocument, JobWorkerService, resolveModel(), OllamaMessage

### Community 14 - "modelRegistry.ts"
Cohesion: 0.15
Nodes (13): CapabilitiesController, capabilitiesController, router, CapabilitiesOutDto, CapabilitiesService, INTERNAL_ROLES, InternalRole, isPublicCapability() (+5 more)

### Community 15 - "jobWorkerService.ts"
Cohesion: 0.25
Nodes (9): CODE_SET, CODES, displayNames, getTranslateLanguageName(), languageName(), TRANSLATEGEMMA_LANGUAGES, TranslateLanguage, buildTranslateGemmaPrompt() (+1 more)

### Community 16 - "jsonOutputGuard.ts"
Cohesion: 0.14
Nodes (20): CreateGuidanceDto, GuidanceAgentItemDto, GuidanceOutDto, UpdateGuidanceDto, GuidanceInterface, GuidanceModel, guidanceSchema, GuidanceController (+12 more)

### Community 17 - "tsconfig.json"
Cohesion: 0.18
Nodes (10): dist, **/*.ts, @tsconfig/node22/tsconfig.json, compilerOptions, forceConsistentCasingInFileNames, outDir, rootDir, exclude (+2 more)

### Community 18 - "ollamaClient.ts"
Cohesion: 0.12
Nodes (17): DEFAULT_MAX_CONCURRENT_NON_PRIORITY_JOBS, buildJsonOutputSystemPrompt(), DEFAULTS, OllamaChatOptions, OllamaChatRequest, OllamaChatResponse, OllamaChatResponseMessage, OllamaClientConfig (+9 more)

### Community 20 - "OllamaClient"
Cohesion: 0.24
Nodes (9): CreateSnippetDto, SnippetOutDto, UpdateSnippetDto, SnippetService, TopicDoc, toSnippetOutDto(), deleteArticleFileIfUnused(), countImageBlocks() (+1 more)

### Community 21 - "widget.model.ts"
Cohesion: 0.08
Nodes (24): ButtonTextAlign, HomeButtonElement, HomeCanvasElement, HomeElementBorderStyle, HomeElementLayout, HomeElementType, HomeFaqElement, HomeFaqEntry (+16 more)

### Community 23 - "deepseekClient.ts"
Cohesion: 0.11
Nodes (22): jszip, jszip, ArticleSyncStatus, ExportArticleOutDto, ImportArticleDto, UpdateArticleDto, TOPIC_SYNC_VALUES, TOPIC_TYPE_VALUES (+14 more)

### Community 24 - "WidgetService"
Cohesion: 0.17
Nodes (13): ChatSessionOutDto, ChatSessionModel, Widget, assertOwnedApiKey(), homeOrDefault(), tabOrDefault(), toChatSessionOutDto(), toPublicWidgetOutDto() (+5 more)

### Community 25 - "articleBucket.ts"
Cohesion: 0.13
Nodes (25): contentTypeOf(), ArticleFileResult, computePhash(), deleteArticleFile(), deleteArticleFileIfExists(), findArticleFile(), findOwnedArticleFile(), findSimilarArticleFile() (+17 more)

### Community 26 - "widget.service.ts"
Cohesion: 0.15
Nodes (23): PublicArticleDetailOutDto, PublicArticleTopicOutDto, HomeCanvasElementDto, PublicFaqArticleOutDto, PublicFaqContentOutDto, PublicFaqTopicOutDto, PublicWidgetOutDto, UpdateWidgetDto (+15 more)

### Community 27 - "widget.controller.ts"
Cohesion: 0.10
Nodes (23): AgentInfluenceArticleDto, AgentInfluenceChunkDto, AgentInfluenceDeclaredToolDto, AgentInfluenceDto, AgentInfluenceGuidanceDto, AgentInfluenceToolDto, AgentInfluenceTopicDto, AgentController (+15 more)

### Community 28 - "message.interface.ts"
Cohesion: 0.10
Nodes (22): ChatMessageInterface, MESSAGE_CONTENT_BLOCK_TYPES, MESSAGE_ROLES, MessageArticleBlock, MessageChunkBlock, MessageContentBlock, MessageContentBlockType, MessageContextInfluence (+14 more)

### Community 29 - "agent.graph.ts"
Cohesion: 0.14
Nodes (28): createLlmProvider(), buildLlmMessages(), CompiledAgentGraph, completeChat(), createAgentGraph(), decideRetrieval(), extractJsonObject(), formatGuidances() (+20 more)

### Community 30 - "widgetValidation.ts"
Cohesion: 0.25
Nodes (21): BUTTON_TEXT_ALIGN_VALUES, HOME_ELEMENT_TYPE_VALUES, optionalButtonStyleFields(), optionalColor(), optionalElementBorderFields(), optionalFontSize(), optionalHexField(), optionalNumberField() (+13 more)

### Community 31 - "agent.service.ts"
Cohesion: 0.23
Nodes (14): AgentTurnEvent, deleteMemoriesForSession(), AgentService, assertOwnedSession(), assistantContent(), contextFromTurn(), defaultLlmConfig(), emptyContext() (+6 more)

### Community 32 - "mcp.interface.ts"
Cohesion: 0.07
Nodes (63): CreateMcpDto, McpAuthenticationPublic, McpAuthPublicConfig, McpOutDto, McpSyncResultDto, McpToolOutDto, UpdateMcpDto, UpdateMcpToolDto (+55 more)

### Community 33 - "plan.service.ts"
Cohesion: 0.17
Nodes (13): CreatePlanDto, PlanOutDto, UpdatePlanDto, PlanInterface, PlanModel, PlanSchema, UpdateAppConfigInput, PlanController (+5 more)

### Community 34 - "agent.controller.ts"
Cohesion: 0.22
Nodes (8): AgentGraphState, AgentGraphUpdate, AgentResolvedReferences, AgentResolvedToolCall, AgentResolvedTopicRef, AgentStateAnnotation, RetrievedChunk, DeclaredAgentTool

### Community 37 - "mail.service.ts"
Cohesion: 0.27
Nodes (4): env, layout(), mailer, MailService

### Community 38 - "createLlmProvider.ts"
Cohesion: 0.26
Nodes (13): ollamaProvider, LlmProvider, OllamaProvider, parseToolArguments(), parseToolCalls(), toOllamaMessages(), toOllamaTools(), LlmChatConfig (+5 more)

### Community 39 - "logger.ts"
Cohesion: 0.20
Nodes (6): format(), location(), Otpinterface, OtpModel, otpSchema, OtpService

### Community 41 - ".chunkArticle"
Cohesion: 0.14
Nodes (16): ChunkInterface, ChunkModel, chunkSchema, deleteChunkPoints(), ensureChunkCollection(), QdrantChunkPoint, QdrantChunkSearchHit, searchChunkPoints() (+8 more)

### Community 42 - "topicValidation.ts"
Cohesion: 0.23
Nodes (14): CreateTopicDto, ReorderTopicsDto, UpdateTopicDto, coerceTopicContent(), legacyArrayToBlocks(), mediaIdsFromBlocks(), mediaIdsFromContent(), mediaIdToString() (+6 more)

### Community 43 - "UserModel"
Cohesion: 0.22
Nodes (8): authenticateByToken(), AuthError, UserInterface, userSchema, Express, Request, AccessTokenPayload, verifyAccessToken()

### Community 44 - "agent.memory.ts"
Cohesion: 0.29
Nodes (8): AgentMemoryInterface, AgentMemoryModel, agentMemorySchema, applyMemoryUpdates(), MemoryDoc, MemoryEntry, MemoryUpdates, normalizeKey()

### Community 45 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, format, format:check, lint, lint:fix, start (+2 more)

### Community 47 - "package.json"
Cohesion: 0.25
Nodes (7): author, description, keywords, license, name, type, version

### Community 48 - "topic.model.ts"
Cohesion: 0.17
Nodes (9): ApiResponseDto, requireAdmin(), adminController, router, upload, AppConfigController, appConfigController, router (+1 more)

### Community 49 - "agent.state.ts"
Cohesion: 0.15
Nodes (13): AdminController, AppConfigPayload, parseEmailSearchQuery(), parseUpdateAdminUserDto(), JOB_TYPE_SET, parseAccentColor(), parseBoolean(), parseCapabilities() (+5 more)

### Community 50 - "mcpTool.model.ts"
Cohesion: 1.00
Nodes (3): chatOrDefault(), coerceChatSettings(), defaultChatSettings()

## Knowledge Gaps
- **218 isolated node(s):** `name`, `version`, `description`, `dev`, `start` (+213 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report**    run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `jszip` connect `deepseekClient.ts` to `article.service.ts`, `dependencies`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`, `express`, `mongoose`, `@qdrant/js-client-rest`, `deepseekClient.ts`, `@langchain/core`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Why does `ApiResponseDto` connect `topic.model.ts` to `mcp.interface.ts`, `index.ts`, `plan.service.ts`, `auth.service.ts`, `admin.controller.ts`, `user.service.ts`, `apiKey.service.ts`, `article.controller.ts`, `job.dto.ts`, `modelRegistry.ts`, `jsonOutputGuard.ts`, `agent.state.ts`, `widget.service.ts`, `widget.controller.ts`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _218 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07137254901960784 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `apiKey.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07023705004389816 - nodes in this community are weakly interconnected._