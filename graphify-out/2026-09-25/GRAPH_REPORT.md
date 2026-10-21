# Graph Report - backend  (2026-09-25)

## Corpus Check
- 247 files · ~107,782 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2204 nodes · 6320 edges · 94 communities (88 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.5)
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
- AppConfigService
- AuthController
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
- OllamaClient
- package.json
- topic.model.ts
- @langchain/langgraph
- sharp-phash
- zod
- chatAnalytics.service.ts
- mongoose
- requireApiKeyAccess.ts
- bcrypt
- chatAnalytics.controller.ts
- ChatAnalyticsService
- agent.state.ts
- meetingTool.ts
- apiKeyCollaborator.service.ts
- apiKeyCollaborator.controller.ts
- user.service.ts
- parseApiKeyId
- buildLlmMessages
- plan.service.ts
- apiKeyCollaborator.interface.ts
- MeetingToolService
- guidance.controller.ts
- socket.ts
- ChatAnalyticsDailyModel
- topic.ts
- rerankerClient.ts
- OllamaClient
- McpController
- UserModel
- meetingTool.model.ts
- meetingTool.controller.ts
- .sendOtp
- chatSession.model.ts
- GuidanceController
- widget.route.ts
- fetchRemoteImage.ts
- apiKey.ts
- message.model.ts
- article.route.ts
- apiKey.route.ts
- apiKeyCollaborator.service.test.ts
- AppConfig.route.ts
- guidance.service.test.ts
- batchTest.route.ts
- @modelcontextprotocol/client
- MeetingToolConfigModel

## God Nodes (most connected - your core abstractions)
1. `statusForMessage()` - 153 edges
2. `getApiKeyScope()` - 111 edges
3. `parseApiKeyIdQuery()` - 79 edges
4. `parseApiKeyId()` - 51 edges
5. `ApiKeyModel` - 42 edges
6. `TopicModel` - 42 edges
7. `EntitlementService` - 41 edges
8. `ArticleService` - 37 edges
9. `parseParam()` - 35 edges
10. `WidgetService` - 33 edges

## Surprising Connections (you probably didn't know these)
- `parseImportArticleDto()` --calls--> `parseApiKeyId()`  [EXTRACTED]
  src/validation/article.ts → src/validation/apiKey.ts
- `uploadArticleFile()` --calls--> `uploadFile()`  [EXTRACTED]
  src/buckets/articleBucket.ts → src/buckets/gridfs.ts
- `deleteArticleFile()` --calls--> `deleteFile()`  [EXTRACTED]
  src/buckets/articleBucket.ts → src/buckets/gridfs.ts
- `deleteArticleFileIfUnused()` --references--> `TopicModel`  [EXTRACTED]
  src/buckets/articleBucket.ts → src/models/topic/topic.model.ts
- `findOwnedArticleFile()` --calls--> `findOwnedFile()`  [EXTRACTED]
  src/buckets/articleBucket.ts → src/buckets/gridfs.ts

## Import Cycles
- None detected.

## Communities (94 total, 6 thin omitted)

### Community 0 - "article.service.ts"
Cohesion: 0.19
Nodes (7): TopicOutDto, ArticleModel, ChunkModel, TopicModel, ArticleService, topicOut(), resolveTopicReferences()

### Community 1 - "index.ts"
Cohesion: 0.20
Nodes (8): requireUser, agentController, inviteController, canLeadCapture, router, canMeeting, router, router

### Community 2 - "user.service.ts"
Cohesion: 0.17
Nodes (22): normalizeAgentToolNameKey(), generateResponse(), leadFieldArgs(), loadMemory(), makeAgentTurnChat(), mergeSapAiToolArgs(), aliasesNeededForVariables(), appendDeclaredToolsFromTopics() (+14 more)

### Community 3 - "auth.service.ts"
Cohesion: 0.14
Nodes (15): LoginInDto, LoginOutDto, registerInDto, RegisterOutDto, ResetPasswordInDto, ResetPasswordOutDto, CreateVisitorJwtInDto, CreateVisitorJwtOutDto (+7 more)

### Community 4 - "admin.controller.ts"
Cohesion: 0.05
Nodes (69): ApplyLeadAgentActionDto, LeadAgentActionResultDto, LeadCaptureSettingsOutDto, LeadExportOutDto, LeadMessageOutDto, LeadOutDto, UpdateLeadCaptureSettingsDto, leadFieldValueSchema (+61 more)

### Community 5 - "devDependencies"
Cohesion: 0.10
Nodes (21): devDependencies, @tsconfig/node22, tsx, @types/bcrypt, @types/cors, @types/express, @types/jsonwebtoken, @types/multer (+13 more)

### Community 6 - "apiKey.service.ts"
Cohesion: 0.29
Nodes (11): ApiKeyOutDto, CreateApiKeyDto, CreateApiKeyOutDto, UpdateApiKeyDto, loadApiKeyAccess(), ApiKeyModel, ApiKeyDoc, ApiKeyService (+3 more)

### Community 7 - "article.controller.ts"
Cohesion: 0.14
Nodes (11): ArticleController, multerFiles(), parseArticleRouteId(), parseCreateArticleDto(), parseDescription(), parseForceQuery(), parseImportArticleDto(), parseTitle() (+3 more)

### Community 8 - "AppConfig.service.ts"
Cohesion: 0.06
Nodes (53): CreateVisitorLiveAgentTicketDto, ListAgentTicketsQuery, LiveAgentTicketAiContextTurnDto, LiveAgentTicketDetailOutDto, LiveAgentTicketMessageOutDto, LiveAgentTicketOutDto, LiveAgentTicketRatingDto, PostLiveAgentTicketMessageDto (+45 more)

### Community 9 - "entitlement.service.ts"
Cohesion: 0.08
Nodes (42): ArticleDetailOutDto, formatGuidances(), extFromFilename(), imageMarkdownRef(), parseArticleMarkdown(), ParsedMarkdownArticle, ParsedMarkdownTopic, parseTopicBody() (+34 more)

### Community 10 - "jobValidation.ts"
Cohesion: 0.13
Nodes (26): deleteWidgetFileIfExists(), findOwnedWidgetFile(), uploadWidgetFile(), CreateNewsDto, NewsMediaOutDto, NewsOutDto, PublicNewsDetailOutDto, PublicNewsListItemOutDto (+18 more)

### Community 11 - "job.dto.ts"
Cohesion: 0.07
Nodes (40): SubmitWidgetAiFeedbackDto, WidgetAiFeedbackOutDto, WidgetAnalyticsSummaryOutDto, WidgetCsatCommentDto, WidgetCsatSummaryDto, WidgetUsageNamedCountDto, WidgetVisitOutDto, WIDGET_AI_FEEDBACK_TRIGGERS (+32 more)

### Community 12 - "dependencies"
Cohesion: 0.10
Nodes (21): bcrypt, cors, express, @getbrevo/brevo, jsonwebtoken, multer, dependencies, bcrypt (+13 more)

### Community 13 - "JobWorkerService"
Cohesion: 0.11
Nodes (12): EmissionState, MemoryToolGuardStore, MemoryToolGuardStoreOptions, SessionEmissions, now(), store(), ToolGuardService, TOOL_GUARD_INTENT_RULES (+4 more)

### Community 14 - "modelRegistry.ts"
Cohesion: 0.11
Nodes (19): applyBonsaiToolDeltas(), BONSAI_BASE_URL, BonsaiChunk, BonsaiMessage, BonsaiToolCallDelta, bonsaiToolCalls(), DEFAULTS, OllamaChatOptions (+11 more)

### Community 15 - "jobWorkerService.ts"
Cohesion: 0.11
Nodes (25): BookMeetingConflictDto, BookMeetingSuccessDto, MeetingFieldValueDto, MeetingAvailabilityDto, MeetingAvailabilityWindowDto, MeetingBookingFieldDto, MeetingFieldConfigDto, MeetingSlotDto (+17 more)

### Community 16 - "jsonOutputGuard.ts"
Cohesion: 0.08
Nodes (16): CreateGuidanceDto, GuidanceAgentItemDto, GuidanceOutDto, UpdateGuidanceDto, GuidanceInterface, GuidanceModel, guidanceSchema, EntitlementService (+8 more)

### Community 17 - "tsconfig.json"
Cohesion: 0.18
Nodes (10): dist, **/*.ts, @tsconfig/node22/tsconfig.json, compilerOptions, forceConsistentCasingInFileNames, outDir, rootDir, exclude (+2 more)

### Community 18 - "ollamaClient.ts"
Cohesion: 0.07
Nodes (32): PublicArticleDetailOutDto, PublicArticleTopicOutDto, BindVisitorIdentityDto, ChatSessionVisitorOutDto, CreatePublicChatSessionDto, HomeSectionElementDto, PublicChatMessageOutDto, PublicChatMessagesOutDto (+24 more)

### Community 19 - "JobService"
Cohesion: 0.07
Nodes (48): BatchTestGroupDetailOutDto, BatchTestGroupOutDto, BatchTestGroupProgressDto, BatchTestGroupProgressOutDto, BatchTestGroupSummaryDto, BatchTestQuestionExecutionDto, BatchTestQuestionOutDto, BulkBatchTestQuestionIdsDto (+40 more)

### Community 20 - "OllamaClient"
Cohesion: 0.22
Nodes (12): deleteArticleFileIfUnused(), CreateSnippetDto, SnippetOutDto, UpdateSnippetDto, snippetOut(), SnippetService, TopicDoc, toSnippetOutDto() (+4 more)

### Community 21 - "widget.model.ts"
Cohesion: 0.22
Nodes (8): AgentInfluenceArticleDto, AgentInfluenceChunkDto, AgentInfluenceDeclaredToolDto, AgentInfluenceDto, AgentInfluenceGuidanceDto, AgentInfluenceToolDto, AgentInfluenceTopicDto, AgentToolUiEvent

### Community 22 - "PUBLIC_CAPABILITIES"
Cohesion: 0.14
Nodes (6): ChatAnalyticsController, LiveAgentController, parseAnalyticsRouteId(), parseCategoryRouteId(), statusForMessage(), parseLiveAgentRouteId()

### Community 23 - "deepseekClient.ts"
Cohesion: 0.10
Nodes (25): jszip, jszip, ArticleOutDto, ArticleSyncStatus, CreateArticleDto, ExportArticleOutDto, ImportArticleDto, UpdateArticleDto (+17 more)

### Community 24 - "WidgetService"
Cohesion: 0.08
Nodes (44): openWidgetDownload(), ChatSessionOutDto, PublicFaqContentOutDto, ChatSessionInterface, ChatSessionVisitor, ChatSessionVisitorAuthMode, ChatSessionModel, chatSessionSchema (+36 more)

### Community 25 - "articleBucket.ts"
Cohesion: 0.05
Nodes (58): deleteLiveAgentFileIfExists(), CreateLiveAgentDto, LiveAgentLoginDto, LiveAgentLoginOutDto, LiveAgentMediaOutDto, LiveAgentMeOutDto, LiveAgentOutDto, LiveAgentResilience (+50 more)

### Community 26 - "widget.service.ts"
Cohesion: 0.21
Nodes (19): NewsCtaDto, ALLOWED_TAGS, altFromAttrs(), decodeAttr(), encodeAttr(), hrefFromAttrs(), isHttpUrl(), isNewsContentEmpty() (+11 more)

### Community 27 - "widget.controller.ts"
Cohesion: 0.10
Nodes (12): apiKeyIdFromParam(), resolveApiKeyIdFromRequest(), NewsController, parsePublicKey(), parseArticleIdParam(), parseMediaIdParam(), parsePublicKeyParam(), parseSessionIdParam() (+4 more)

### Community 28 - "message.interface.ts"
Cohesion: 0.08
Nodes (33): ChatAnalyticsInterface, chatAnalyticsSchema, ChatMessageInterface, MESSAGE_CONTENT_BLOCK_TYPES, MESSAGE_ROLES, MessageArticleBlock, MessageChunkBlock, MessageContentBlock (+25 more)

### Community 29 - "agent.graph.ts"
Cohesion: 0.14
Nodes (27): AgentPipelineEvent, auditFailTool(), auditOkTool(), auditToolArgs(), completeChat(), decideRetrieval(), expandRetrievalQueries(), extractJsonObject() (+19 more)

### Community 30 - "widgetValidation.ts"
Cohesion: 0.08
Nodes (39): ArticleFileResult, computePhash(), deleteAllArticleFilesForApiKey(), deleteArticleFile(), deleteArticleFileIfExists(), findArticleFile(), findSimilarArticleFile(), getArticleBucket() (+31 more)

### Community 31 - "agent.service.ts"
Cohesion: 0.16
Nodes (26): AgentTurnEvent, AgentExecutionMode, deleteMemoriesForSession(), meetingBookingMarkerRe(), stripModelLeakTags(), AgentService, assertOwnedSession(), assistantContent() (+18 more)

### Community 32 - "mcp.interface.ts"
Cohesion: 0.07
Nodes (57): CreateMcpDto, McpAuthenticationPublic, McpAuthPublicConfig, McpOutDto, McpSyncResultDto, McpToolOutDto, UpdateMcpDto, UpdateMcpToolDto (+49 more)

### Community 33 - "plan.service.ts"
Cohesion: 0.40
Nodes (4): requireAdmin(), adminController, router, upload

### Community 34 - "AppConfigService"
Cohesion: 0.16
Nodes (14): formatRetrievedContext(), MemoryEntry, AgentResolvedReferences, AgentResolvedToolCall, AgentResolvedTopicRef, AgentTurnState, RetrievedChunk, DeclaredAgentTool (+6 more)

### Community 36 - "job.dto.ts"
Cohesion: 0.32
Nodes (3): buildTranslatePrompt(), OllamaClient, toOllamaMessages()

### Community 37 - "mail.service.ts"
Cohesion: 0.43
Nodes (3): escapeHtml(), layout(), MailService

### Community 38 - "createLlmProvider.ts"
Cohesion: 0.12
Nodes (25): CreateMeetingTopicDto, EnabledMeetingTopicForAgent, MeetingBookingPayloadDto, MeetingTopicListOutDto, MeetingTopicOutDto, UpdateMeetingTopicDto, meetingTopicToolName(), resolveWeeklySchedule() (+17 more)

### Community 39 - "logger.ts"
Cohesion: 0.14
Nodes (7): SendOtpInDto, Otpinterface, OtpModel, otpSchema, OtpService, encodeResetToken(), ResetTokenPayload

### Community 40 - "AdminService"
Cohesion: 0.13
Nodes (20): AnalyticsCategoryInterface, AnalyticsOptionSeed, PROJECT_ANALYTICS_ANSWERABLE_SEEDS, PROJECT_ANALYTICS_CATEGORY_SEEDS, PROJECT_ANALYTICS_GAP_SEEDS, PROJECT_ANALYTICS_INTENT_SEEDS, PROJECT_ANALYTICS_OPTION_SEEDS, PROJECT_ANALYTICS_TYPE_SEEDS (+12 more)

### Community 41 - ".chunkArticle"
Cohesion: 0.09
Nodes (27): ChunkInterface, chunkSchema, TOPIC_SYNC_VALUES, TOPIC_TYPE_VALUES, TopicInterface, TopicSyncStatus, TopicType, topicSchema (+19 more)

### Community 42 - "topicValidation.ts"
Cohesion: 0.15
Nodes (13): AdminUserOutDto, UpdateAdminUserDto, UserPlanOutDto, AppConfigPayload, AuthorshipDoc, PopulatedUserDoc, toAdminUserOutDto(), toUserPlanOutDto() (+5 more)

### Community 43 - "UserModel"
Cohesion: 0.35
Nodes (7): parseBonsaiSseLine(), toBonsaiMessages(), toOllamaTools(), LlmChatConfig, LlmChatMessage, LlmChatTurnResult, LlmToolDefinition

### Community 44 - "agent.memory.ts"
Cohesion: 0.27
Nodes (8): AgentMemoryInterface, AgentMemoryModel, agentMemorySchema, applyMemoryUpdates(), listMemories(), MemoryDoc, MemoryUpdates, normalizeKey()

### Community 45 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, format, format:check, lint, lint:fix, start (+2 more)

### Community 46 - "OllamaClient"
Cohesion: 0.22
Nodes (10): BatchTestController, parseBatchTestGroupId(), parseBatchTestQuestionId(), parseBulkBatchTestQuestionIdsDto(), parseCreateBatchTestGroupDto(), parseCreateBatchTestQuestionDto(), parseNonEmptyString(), parseSetBatchTestRatingDto() (+2 more)

### Community 47 - "package.json"
Cohesion: 0.25
Nodes (7): author, description, keywords, license, name, type, version

### Community 48 - "topic.model.ts"
Cohesion: 0.10
Nodes (41): BUTTON_TEXT_ALIGN_VALUES, ButtonTextAlign, HOME_SECTION_TYPE_VALUES, HomeFaqElement, HomeFaqEntry, HomeGoToChatElement, HomeLatestNewsElement, HomeLinkCardElement (+33 more)

### Community 49 - "@langchain/langgraph"
Cohesion: 0.14
Nodes (21): AcceptApiKeyCollaborationInviteOutDto, CollaborationInviteAcceptRole, CreateApiKeyCollaborationInviteOutDto, ApiKeyCollaborationInviteInterface, ApiKeyCollaborationInviteModel, apiKeyCollaborationInviteSchema, ApiKeyCollaborationInviteService, ApiKeySummary (+13 more)

### Community 50 - "sharp-phash"
Cohesion: 0.17
Nodes (15): BookMeetingDto, BookMeetingResultDto, MeetingOutDto, SessionMeetingFactDto, MeetingModel, isDuplicateKeyError(), MeetingDoc, meetingEndsAt() (+7 more)

### Community 51 - "zod"
Cohesion: 0.18
Nodes (8): AdminController, parseAccentColor(), parseBoolean(), parseCreatePlanDto(), parseNumber(), parseRouteId(), parseString(), parseUpdatePlanDto()

### Community 52 - "chatAnalytics.service.ts"
Cohesion: 0.13
Nodes (11): getApiKeyScope(), GuidanceController, LeadCaptureController, parseLeadId(), McpController, MeetingToolController, parseApiKeyIdQuery(), parseGuidanceRouteId() (+3 more)

### Community 54 - "requireApiKeyAccess.ts"
Cohesion: 0.24
Nodes (15): ApiKeyAccess, ApiKeyAccessRole, ApiKeyIdResolver, ApiKeySummary, attachApiKeyAccess(), hasApiKeyPermission(), json(), requireAnyApiKeyPermission() (+7 more)

### Community 56 - "chatAnalytics.controller.ts"
Cohesion: 0.32
Nodes (12): ANALYTICS_OPTION_DIMENSIONS, OPTION_DIMENSION_SET, parseAnalyticsOptionDimension(), parseAnalyticsRecordsQuery(), parseAnalyticsSummaryQuery(), parseAnalyticsTrendsQuery(), parseCreateAnalyticsCategoryDto(), parseOptionalDate() (+4 more)

### Community 57 - "ChatAnalyticsService"
Cohesion: 0.14
Nodes (13): ChatAnalyticsConversationOutDto, ChatAnalyticsRecordOutDto, ChatAnalyticsRecordsPageOutDto, AnalyticsOptionDimension, AnalyticsCategoryModel, ChatAnalyticsModel, ChatMessageModel, AnalyticsGapGroup (+5 more)

### Community 58 - "agent.state.ts"
Cohesion: 0.23
Nodes (10): CreatePlanDto, PlanOutDto, UpdatePlanDto, PlanInterface, PlanModel, PlanSchema, UpdateAppConfigInput, PlanDoc (+2 more)

### Community 59 - "meetingTool.ts"
Cohesion: 0.23
Nodes (18): MEETING_FIELD_TYPE_VALUES, defaultLabelForType(), isBreakInsideWindows(), isValidIanaTimezone(), parseAvailabilityWindow(), parseBlackoutDate(), parseBoolean(), parseFieldConfig() (+10 more)

### Community 60 - "apiKeyCollaborator.service.ts"
Cohesion: 0.27
Nodes (11): ApiKeyCollaboratorOutDto, CreateApiKeyCollaboratorDto, UpdateApiKeyCollaboratorDto, CollaboratorPermissions, defaultCollaboratorPermissions(), ApiKeyCollaboratorModel, ApiKeyCollaboratorDoc, ApiKeyCollaboratorService (+3 more)

### Community 61 - "apiKeyCollaborator.controller.ts"
Cohesion: 0.18
Nodes (8): ApiKeyController, ApiKeyCollaborationInviteController, ApiKeyCollaboratorController, parseRouteId(), parseBoolean(), parseCollaboratorPermissions(), parseCollaboratorUserId(), requireUserId()

### Community 62 - "user.service.ts"
Cohesion: 0.11
Nodes (16): isPredictResponse(), LayaAction, LayaAnswer, LayaChoiceAnswer, LayaChoiceQuestion, LayaClient, LayaClientConfig, LayaNoulAnswer (+8 more)

### Community 63 - "parseApiKeyId"
Cohesion: 0.15
Nodes (17): DeepseekChatRequest, DeepseekChatRole, DeepseekChunk, DeepseekClientConfig, DeepseekDelta, DeepseekMessage, DeepseekTool, DeepseekToolCall (+9 more)

### Community 64 - "buildLlmMessages"
Cohesion: 0.22
Nodes (14): buildLlmMessages(), imageHandleSources(), prepareMessages(), clockContextPrompt(), conversationResolvedPrompt(), imageHandlesPrompt(), leadCapturePrompt(), liveAgentOfferPrompt() (+6 more)

### Community 65 - "plan.service.ts"
Cohesion: 0.32
Nodes (6): LlmChatRole, LlmProviderName, LlmTokenUsage, LlmToolCall, textFromMessage(), toLlmHistory()

### Community 66 - "apiKeyCollaborator.interface.ts"
Cohesion: 0.14
Nodes (12): AccessMod, ApiKeyModelType, CollaboratorServiceMod, fakeRes(), run(), API_KEY_PERMISSION_VALUES, ApiKeyCollaboratorInterface, ApiKeyPermission (+4 more)

### Community 67 - "MeetingToolService"
Cohesion: 0.33
Nodes (5): ApiKeyModelType, ApiKeyServiceMod, CollabModelType, CollabServiceMod, UserModelType

### Community 68 - "guidance.controller.ts"
Cohesion: 0.27
Nodes (7): AnalyticsCategoryOutDto, ChatAnalyticsConversationMessageOutDto, ChatAnalyticsTrendSeriesOutDto, ChatAnalyticsTrendsOutDto, CreateAnalyticsCategoryDto, UpdateAnalyticsCategoryDto, toCategoryOutDto()

### Community 69 - "socket.ts"
Cohesion: 0.33
Nodes (5): canTrainSnippets, imageUpload, requireTrain, router, snippetController

### Community 70 - "ChatAnalyticsDailyModel"
Cohesion: 0.26
Nodes (6): ChatAnalyticsSummaryOutDto, ChatAnalyticsDailyInterface, ChatAnalyticsDailyModel, chatAnalyticsDailySchema, mapToRecord(), utcDayStart()

### Community 71 - "topic.ts"
Cohesion: 0.24
Nodes (13): CreateTopicDto, ReorderTopicsDto, UpdateTopicDto, coerceTopicContent(), legacyArrayToBlocks(), mediaIdsFromBlocks(), mediaIdsFromContent(), mediaIdToString() (+5 more)

### Community 72 - "rerankerClient.ts"
Cohesion: 0.27
Nodes (6): isRerankResponse(), isRerankResult(), RerankerClient, RerankerClientConfig, RerankResponse, RerankResult

### Community 73 - "OllamaClient"
Cohesion: 0.40
Nodes (3): UserController, router, userController

### Community 74 - "McpController"
Cohesion: 0.25
Nodes (8): SnippetController, parseBooleanField(), parseContent(), parseCreateSnippetDto(), parseForceQuery(), parseSnippetRouteId(), parseUpdateSnippetDto(), parseTopicName()

### Community 75 - "UserModel"
Cohesion: 0.50
Nodes (7): addDeepseekTokens(), canUseDeepseek(), nextDeepseekUsage(), shouldUseDeepseek(), usedThisMonth(), utcUsageMonth(), UserModel

### Community 76 - "meetingTool.model.ts"
Cohesion: 0.22
Nodes (7): MeetingTopicInterface, meetingAvailabilityWindowSchema, meetingFieldSchema, meetingTimeRangeSchema, meetingTopicSchema, weeklyDayScheduleSchema, weeklyHourSchema

### Community 77 - "meetingTool.controller.ts"
Cohesion: 0.33
Nodes (6): parseMeetingTopicIdQuery(), parsePublicKey(), parseSessionIdQuery(), parseAvailabilityRangeQuery(), parseBookMeetingDto(), parseCreateMeetingTopicDto()

### Community 78 - ".sendOtp"
Cohesion: 0.50
Nodes (3): batchTestController, canTest, router

### Community 79 - "chatSession.model.ts"
Cohesion: 0.29
Nodes (6): requireLiveAgent, canLiveAgent, imageUpload, liveAgentController, router, ticketController

### Community 80 - "GuidanceController"
Cohesion: 0.50
Nodes (3): canTrainGuidance, guidanceController, router

### Community 81 - "widget.route.ts"
Cohesion: 0.29
Nodes (6): canWidget, imageUpload, meetingToolController, router, ticketController, widgetController

### Community 82 - "fetchRemoteImage.ts"
Cohesion: 0.31
Nodes (5): findOwnedArticleFile(), uploadArticleFile(), processArticleImage(), ProcessedArticleImage, assertImageFile()

### Community 83 - "apiKey.ts"
Cohesion: 0.50
Nodes (3): canMcp, mcpController, router

### Community 84 - "message.model.ts"
Cohesion: 0.18
Nodes (13): ApiResponseDto, AgentController, isResponseGone(), parsePublicKeyParam(), parseTestChatBody(), SseEvent, writeSse(), parseBoolean() (+5 more)

### Community 85 - "article.route.ts"
Cohesion: 0.29
Nodes (6): articleController, canTrainArticles, imageUpload, importUpload, requireTrain, router

### Community 86 - "apiKey.route.ts"
Cohesion: 0.33
Nodes (5): apiKeyController, collaboratorController, inviteController, requireOwner, router

### Community 89 - "AppConfig.route.ts"
Cohesion: 0.12
Nodes (14): connectDatabase(), bootstrap(), createApp(), router, router, AppConfigController, appConfigController, router (+6 more)

### Community 90 - "guidance.service.test.ts"
Cohesion: 0.50
Nodes (3): GuidanceModelType, GuidanceServiceMod, UserServiceMod

### Community 91 - "batchTest.route.ts"
Cohesion: 0.67
Nodes (6): assertPublicResolvedHost(), fetchRemoteImageBuffer(), isBlockedHostname(), isPrivateIpv4(), isPrivateIpv6(), parseImageUrl()

## Knowledge Gaps
- **357 isolated node(s):** `name`, `version`, `description`, `dev`, `start` (+352 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `statusForMessage()` connect `PUBLIC_CAPABILITIES` to `apiKey.service.ts`, `article.controller.ts`, `AppConfig.service.ts`, `McpController`, `jobValidation.ts`, `job.dto.ts`, `meetingTool.controller.ts`, `OllamaClient`, `@langchain/langgraph`, `ollamaClient.ts`, `message.model.ts`, `chatAnalytics.service.ts`, `chatAnalytics.controller.ts`, `articleBucket.ts`, `widget.controller.ts`, `apiKeyCollaborator.controller.ts`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `ArticleService` connect `article.service.ts` to `apiKey.service.ts`, `article.controller.ts`, `entitlement.service.ts`, `fetchRemoteImage.ts`, `deepseekClient.ts`, `WidgetService`, `agent.graph.ts`, `widgetValidation.ts`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `logger` connect `auth.service.ts` to `rerankerClient.ts`, `AdminService`, `AppConfig.service.ts`, `topicValidation.ts`, `job.dto.ts`, `.chunkArticle`, `modelRegistry.ts`, `sharp-phash`, `JobService`, `articleBucket.ts`, `AppConfig.route.ts`, `agent.state.ts`, `agent.service.ts`, `agent.graph.ts`, `user.service.ts`, `parseApiKeyId`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _357 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `auth.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13825757575757575 - nodes in this community are weakly interconnected._
- **Should `admin.controller.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05030525030525031 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._