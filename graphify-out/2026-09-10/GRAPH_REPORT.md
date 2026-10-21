# Graph Report - backend  (2026-09-10)

## Corpus Check
- 153 files · ~51,933 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1236 nodes · 3229 edges · 53 communities (47 shown, 6 thin omitted)
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
- package.json
- topic.model.ts
- mongoose
- @qdrant/js-client-rest
- bcrypt
- @langchain/core
- agent.state.ts
- @langchain/core
- @modelcontextprotocol/client

## God Nodes (most connected - your core abstractions)
1. `TopicModel` - 38 edges
2. `ArticleService` - 31 edges
3. `parseApiKeyId()` - 29 edges
4. `EntitlementService` - 27 edges
5. `parseContentToBlocks()` - 23 edges
6. `ArticleModel` - 22 edges
7. `WidgetService` - 22 edges
8. `JobType` - 20 edges
9. `ApiResponseDto` - 19 edges
10. `parseParam()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `parseImportArticleDto()` --calls--> `parseApiKeyId()`  [EXTRACTED]
  src/utils/articleValidation.ts → src/utils/apiKeyValidation.ts
- `CreateOcrJobDto` --references--> `JobMessageInterface`  [EXTRACTED]
  src/dto/job.dto.ts → src/models/job/job.interface.ts
- `JobOutDto` --references--> `JobResultInterface`  [EXTRACTED]
  src/dto/job.dto.ts → src/models/job/job.interface.ts
- `JobOutDto` --references--> `JobType`  [EXTRACTED]
  src/dto/job.dto.ts → src/models/job/job.interface.ts
- `AdminRunJobWorkerOutDto` --references--> `JobStatus`  [EXTRACTED]
  src/dto/job.dto.ts → src/models/job/job.interface.ts

## Import Cycles
- None detected.

## Communities (53 total, 6 thin omitted)

### Community 0 - "article.service.ts"
Cohesion: 0.19
Nodes (10): ArticleDetailOutDto, ArticleOutDto, TopicOutDto, ArticleModel, TopicModel, ArticleService, computeSyncStatus(), toArticleOutDto() (+2 more)

### Community 1 - "index.ts"
Cohesion: 0.06
Nodes (35): connectDatabase(), bootstrap(), createApp(), readBearer(), requireAuth(), requireUser, agentController, router (+27 more)

### Community 2 - "user.service.ts"
Cohesion: 0.22
Nodes (10): CreateVisitorJwtInDto, CreateVisitorJwtOutDto, isPlainObject(), sanitizeClaims(), SignedVisitorJwt, signVisitorJwt(), SignVisitorJwtInput, VerifiedVisitorIdentity (+2 more)

### Community 3 - "auth.service.ts"
Cohesion: 0.14
Nodes (9): LoginInDto, LoginOutDto, registerInDto, RegisterOutDto, ResetPasswordInDto, ResetPasswordOutDto, AuthController, AuthService (+1 more)

### Community 4 - "admin.controller.ts"
Cohesion: 0.31
Nodes (10): requireUserId(), SnippetController, statusForMessage(), parseApiKeyIdQuery(), parseBooleanField(), parseContent(), parseCreateSnippetDto(), parseSnippetRouteId() (+2 more)

### Community 5 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, @tsconfig/node22, tsx, @types/bcrypt, @types/cors, @types/express, @types/jsonwebtoken, @types/multer (+11 more)

### Community 6 - "apiKey.service.ts"
Cohesion: 0.07
Nodes (25): ApiKeyOutDto, CreateApiKeyDto, CreateApiKeyOutDto, UpdateApiKeyDto, AuthError, ApiKeyAuthContext, authenticateByApiKey(), ApiKeyInterface (+17 more)

### Community 7 - "article.controller.ts"
Cohesion: 0.18
Nodes (18): ArticleController, multerFiles(), requireUserId(), statusForMessage(), parseApiKeyIdQuery(), parseArticleRouteId(), parseCreateArticleDto(), parseDescription() (+10 more)

### Community 8 - "AppConfig.service.ts"
Cohesion: 0.27
Nodes (9): AdminRunJobWorkerDto, CreateJobOutDto, CreateOcrJobDto, CreateTranslateJobDto, JobOutDto, TranslateLanguageOutDto, TranslateLanguagesOutDto, JobErrorInterface (+1 more)

### Community 9 - "entitlement.service.ts"
Cohesion: 0.07
Nodes (49): mergeDeclarations(), applyVarBindings(), attr(), bound, decls, depth1, disabledLookup, disabledPass (+41 more)

### Community 10 - "jobValidation.ts"
Cohesion: 0.11
Nodes (25): isValidTranslateLanguageCode(), JobController, estimateBase64DecodedBytes(), isPlainObject(), MESSAGE_ROLES, normalizeBase64Input(), OCR_PROMPTS, OcrJobParsedInput (+17 more)

### Community 11 - "job.dto.ts"
Cohesion: 0.14
Nodes (18): CapabilitiesOutDto, CreateChatJobDto, JOB_STATUS_VALUES, JobInterface, JobMessageInterface, JobType, JsonResultTemplate, jobErrorSchema (+10 more)

### Community 12 - "dependencies"
Cohesion: 0.10
Nodes (21): bcrypt, cors, express, @getbrevo/brevo, jsonwebtoken, @langchain/langgraph, @langchain/textsplitters, multer (+13 more)

### Community 13 - "JobWorkerService"
Cohesion: 0.19
Nodes (9): JobResultInterface, JobDocument, DEFAULT_MAX_CONCURRENT_NON_PRIORITY_JOBS, JobWorkerService, resolveModel(), buildJsonOutputSystemPrompt(), OllamaChatResponse, OllamaGenerateResponse (+1 more)

### Community 14 - "modelRegistry.ts"
Cohesion: 0.15
Nodes (13): CapabilitiesController, capabilitiesController, router, CapabilitiesOutDto, CapabilitiesService, INTERNAL_ROLES, InternalRole, isPublicCapability() (+5 more)

### Community 15 - "jobWorkerService.ts"
Cohesion: 0.25
Nodes (9): CODE_SET, CODES, displayNames, getTranslateLanguageName(), languageName(), TRANSLATEGEMMA_LANGUAGES, TranslateLanguage, buildTranslateGemmaPrompt() (+1 more)

### Community 16 - "jsonOutputGuard.ts"
Cohesion: 0.15
Nodes (19): CreateGuidanceDto, GuidanceAgentItemDto, GuidanceOutDto, UpdateGuidanceDto, GuidanceInterface, GuidanceModel, guidanceSchema, GuidanceController (+11 more)

### Community 17 - "tsconfig.json"
Cohesion: 0.18
Nodes (10): dist, **/*.ts, @tsconfig/node22/tsconfig.json, compilerOptions, forceConsistentCasingInFileNames, outDir, rootDir, exclude (+2 more)

### Community 18 - "ollamaClient.ts"
Cohesion: 0.12
Nodes (14): DEFAULTS, OllamaChatOptions, OllamaChatRequest, OllamaChatResponseMessage, OllamaClient, OllamaClientConfig, OllamaEmbedResponse, OllamaMessageRole (+6 more)

### Community 20 - "OllamaClient"
Cohesion: 0.15
Nodes (20): CreateSnippetDto, SnippetOutDto, UpdateSnippetDto, CreateTopicDto, ReorderTopicsDto, UpdateTopicDto, SnippetService, TopicDoc (+12 more)

### Community 21 - "widget.model.ts"
Cohesion: 0.09
Nodes (22): BUTTON_TEXT_ALIGN_VALUES, ButtonTextAlign, HomeCanvasElement, HomeElementType, HomeFaqElement, HomeFaqEntry, HomeGoToChatElement, HomeLatestNewsElement (+14 more)

### Community 23 - "deepseekClient.ts"
Cohesion: 0.12
Nodes (20): jszip, jszip, ArticleSyncStatus, CreateArticleDto, ExportArticleOutDto, ImportArticleDto, PublicArticleTopicOutDto, UpdateArticleDto (+12 more)

### Community 24 - "WidgetService"
Cohesion: 0.24
Nodes (6): ChatSessionOutDto, ChatSessionModel, Widget, resolveAccessMode(), toChatSessionOutDto(), WidgetService

### Community 25 - "articleBucket.ts"
Cohesion: 0.08
Nodes (28): AppConfigInterface, AppConfigModel, appConfigSchema, AppConfigService, contentTypeOf(), ArticleFileResult, computePhash(), deleteArticleFile() (+20 more)

### Community 26 - "widget.service.ts"
Cohesion: 0.11
Nodes (23): PublicArticleDetailOutDto, BindVisitorIdentityDto, ChatSessionVisitorOutDto, CreatePublicChatSessionDto, HomeCanvasElementDto, PublicFaqArticleOutDto, PublicFaqContentOutDto, PublicFaqTopicOutDto (+15 more)

### Community 27 - "widget.controller.ts"
Cohesion: 0.09
Nodes (25): AgentInfluenceArticleDto, AgentInfluenceChunkDto, AgentInfluenceDeclaredToolDto, AgentInfluenceDto, AgentInfluenceGuidanceDto, AgentInfluenceToolDto, AgentInfluenceTopicDto, AgentController (+17 more)

### Community 28 - "message.interface.ts"
Cohesion: 0.10
Nodes (21): ChatMessageInterface, MESSAGE_CONTENT_BLOCK_TYPES, MESSAGE_ROLES, MessageArticleBlock, MessageChunkBlock, MessageContentBlock, MessageContentBlockType, MessageContextInfluence (+13 more)

### Community 29 - "agent.graph.ts"
Cohesion: 0.14
Nodes (28): buildLlmMessages(), CompiledAgentGraph, completeChat(), createAgentGraph(), decideRetrieval(), extractJsonObject(), formatGuidances(), formatHistoryForGate() (+20 more)

### Community 30 - "widgetValidation.ts"
Cohesion: 0.24
Nodes (21): HOME_SECTION_TYPE_VALUES, VISITOR_JWT_ALGORITHM_VALUES, WIDGET_ACCESS_MODE_VALUES, coerceHomeSettings(), migrateGreeting(), parseAccessMode(), parseAllowedDomains(), parseBoolean() (+13 more)

### Community 31 - "agent.service.ts"
Cohesion: 0.20
Nodes (16): AgentTurnEvent, createLlmProvider(), ChatMessageModel, AgentService, assertOwnedSession(), assistantContent(), contextFromTurn(), defaultLlmConfig() (+8 more)

### Community 32 - "mcp.interface.ts"
Cohesion: 0.07
Nodes (63): CreateMcpDto, McpAuthenticationPublic, McpAuthPublicConfig, McpOutDto, McpSyncResultDto, McpToolOutDto, UpdateMcpDto, UpdateMcpToolDto (+55 more)

### Community 33 - "plan.service.ts"
Cohesion: 0.40
Nodes (3): AppConfigController, appConfigController, router

### Community 36 - "job.dto.ts"
Cohesion: 0.18
Nodes (22): WidgetOutDto, WIDGET_MEDIA_TYPE_VALUES, ArticleDoc, assertOwnedApiKey(), chatOrDefault(), ChatSessionDoc, faqOrDefault(), homeOrDefault() (+14 more)

### Community 37 - "mail.service.ts"
Cohesion: 0.16
Nodes (10): SendOtpInDto, env, format(), location(), logger, layout(), mailer, MailService (+2 more)

### Community 38 - "createLlmProvider.ts"
Cohesion: 0.26
Nodes (13): ollamaProvider, LlmProvider, OllamaProvider, parseToolArguments(), parseToolCalls(), toOllamaMessages(), toOllamaTools(), LlmChatConfig (+5 more)

### Community 39 - "logger.ts"
Cohesion: 0.16
Nodes (6): Otpinterface, OtpModel, otpSchema, OtpService, encodeResetToken(), ResetTokenPayload

### Community 40 - "AdminService"
Cohesion: 0.31
Nodes (8): extFromFilename(), imageMarkdownRef(), ParsedMarkdownArticle, ParsedMarkdownTopic, parseTopicBody(), serializeArticleMarkdown(), serializeTopicContent(), ContentBlock

### Community 41 - ".chunkArticle"
Cohesion: 0.09
Nodes (25): ChunkInterface, ChunkModel, chunkSchema, TOPIC_SYNC_VALUES, TOPIC_TYPE_VALUES, TopicInterface, TopicSyncStatus, TopicType (+17 more)

### Community 42 - "topicValidation.ts"
Cohesion: 0.06
Nodes (37): AdminUserOutDto, UpdateAdminUserDto, ApiResponseDto, AdminRunJobWorkerOutDto, CreatePlanDto, PlanOutDto, UpdatePlanDto, UserPlanOutDto (+29 more)

### Community 43 - "UserModel"
Cohesion: 0.33
Nodes (7): authenticateByToken(), UserInterface, UserModel, userSchema, Express, Request, verifyAccessToken()

### Community 44 - "agent.memory.ts"
Cohesion: 0.29
Nodes (9): AgentMemoryInterface, AgentMemoryModel, agentMemorySchema, applyMemoryUpdates(), deleteMemoriesForSession(), listMemories(), MemoryDoc, MemoryUpdates (+1 more)

### Community 45 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, format, format:check, lint, lint:fix, start (+2 more)

### Community 47 - "package.json"
Cohesion: 0.25
Nodes (7): author, description, keywords, license, name, type, version

### Community 48 - "topic.model.ts"
Cohesion: 0.40
Nodes (4): requireAdmin(), adminController, router, upload

### Community 55 - "bcrypt"
Cohesion: 0.50
Nodes (3): requireApiKey, jobController, router

### Community 56 - "@langchain/core"
Cohesion: 0.33
Nodes (5): ChatSessionInterface, ChatSessionVisitor, ChatSessionVisitorAuthMode, chatSessionSchema, chatSessionVisitorSchema

### Community 58 - "agent.state.ts"
Cohesion: 0.22
Nodes (8): MemoryEntry, AgentGraphState, AgentGraphUpdate, AgentResolvedReferences, AgentResolvedToolCall, AgentResolvedTopicRef, AgentStateAnnotation, RetrievedChunk

## Knowledge Gaps
- **228 isolated node(s):** `name`, `version`, `description`, `dev`, `start` (+223 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report**   run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `jszip` connect `deepseekClient.ts` to `article.service.ts`, `dependencies`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`, `mongoose`, `@qdrant/js-client-rest`, `deepseekClient.ts`, `@langchain/core`, `@modelcontextprotocol/client`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Why does `ArticleService` connect `article.service.ts` to `job.dto.ts`, `article.controller.ts`, `.chunkArticle`, `deepseekClient.ts`, `articleBucket.ts`, `agent.graph.ts`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _228 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06485671191553545 - nodes in this community are weakly interconnected._
- **Should `auth.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14130434782608695 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._