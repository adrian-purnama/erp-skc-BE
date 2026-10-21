# Graph Report - backend  (2026-09-22)

## Corpus Check
- 234 files · ~97,373 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2012 nodes · 5864 edges · 96 communities (89 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.5)
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
- AdminController
- requireUser
- McpController
- apiKeyCollaborationInvite.controller.ts
- meetingTool.model.ts
- meetingTool.controller.ts
- UserModel
- .sendOtp
- article.route.ts
- widget.route.ts
- fetchRemoteImage.ts
- apiKey.ts
- plan.ts
- jwt.ts
- apiKey.route.ts
- apiKeyCollaborator.service.test.ts
- snippet.route.ts
- batchTest.route.ts
- guidance.service.test.ts
- mcp.route.ts
- meetingTool.route.ts
- @modelcontextprotocol/client
- MeetingToolConfigModel

## God Nodes (most connected - your core abstractions)
1. `statusForMessage()` - 146 edges
2. `getApiKeyScope()` - 104 edges
3. `parseApiKeyIdQuery()` - 72 edges
4. `parseApiKeyId()` - 51 edges
5. `ApiKeyModel` - 42 edges
6. `TopicModel` - 41 edges
7. `EntitlementService` - 38 edges
8. `ArticleService` - 35 edges
9. `parseParam()` - 35 edges
10. `WidgetService` - 33 edges

## Surprising Connections (you probably didn't know these)
- `parseImportArticleDto()` --calls--> `parseApiKeyId()`  [EXTRACTED]
  src/validation/article.ts → src/validation/apiKey.ts
- `getArticleBucket()` --calls--> `getBucket()`  [EXTRACTED]
  src/buckets/articleBucket.ts → src/buckets/gridfs.ts
- `uploadArticleFile()` --calls--> `uploadFile()`  [EXTRACTED]
  src/buckets/articleBucket.ts → src/buckets/gridfs.ts
- `deleteArticleFile()` --calls--> `deleteFile()`  [EXTRACTED]
  src/buckets/articleBucket.ts → src/buckets/gridfs.ts
- `deleteArticleFileIfExists()` --calls--> `deleteFileIfExists()`  [EXTRACTED]
  src/buckets/articleBucket.ts → src/buckets/gridfs.ts

## Import Cycles
- None detected.

## Communities (96 total, 7 thin omitted)

### Community 0 - "article.service.ts"
Cohesion: 0.14
Nodes (14): ArticleOutDto, TopicOutDto, ArticleModel, articleDetailOut(), articleOut(), ArticleService, computeSyncStatus(), toArticleOutDto() (+6 more)

### Community 1 - "index.ts"
Cohesion: 0.16
Nodes (12): connectDatabase(), bootstrap(), createApp(), format(), location(), logger, authController, router (+4 more)

### Community 2 - "user.service.ts"
Cohesion: 0.36
Nodes (7): isPlainObject(), sanitizeClaims(), SignedVisitorJwt, signVisitorJwt(), SignVisitorJwtInput, VerifiedVisitorIdentity, verifyVisitorJwt()

### Community 3 - "auth.service.ts"
Cohesion: 0.25
Nodes (10): LoginInDto, LoginOutDto, registerInDto, RegisterOutDto, ResetPasswordInDto, ResetPasswordOutDto, CreateVisitorJwtInDto, CreateVisitorJwtOutDto (+2 more)

### Community 4 - "admin.controller.ts"
Cohesion: 0.25
Nodes (8): SnippetController, parseBooleanField(), parseContent(), parseCreateSnippetDto(), parseForceQuery(), parseSnippetRouteId(), parseUpdateSnippetDto(), parseTopicName()

### Community 5 - "devDependencies"
Cohesion: 0.10
Nodes (21): devDependencies, @tsconfig/node22, tsx, @types/bcrypt, @types/cors, @types/express, @types/jsonwebtoken, @types/multer (+13 more)

### Community 6 - "apiKey.service.ts"
Cohesion: 0.30
Nodes (10): ApiKeyOutDto, CreateApiKeyDto, CreateApiKeyOutDto, UpdateApiKeyDto, ApiKeyModel, ApiKeyDoc, ApiKeyService, cascadeDeleteForApiKey() (+2 more)

### Community 7 - "article.controller.ts"
Cohesion: 0.22
Nodes (5): getApiKeyScope(), ArticleController, multerFiles(), parseArticleRouteId(), parseTopicRouteId()

### Community 8 - "AppConfig.service.ts"
Cohesion: 0.23
Nodes (11): LiveAgentTicketDetailOutDto, LiveAgentTicketMessageOutDto, LiveAgentTicketOutDto, LiveAgentTicketModel, LiveAgentTicketMessageModel, LiveAgentTicketService, previewOf(), toMessageDto() (+3 more)

### Community 9 - "entitlement.service.ts"
Cohesion: 0.08
Nodes (42): extFromFilename(), imageMarkdownRef(), ParsedMarkdownArticle, ParsedMarkdownTopic, parseTopicBody(), serializeArticleMarkdown(), serializeTopicContent(), applyVarBindings() (+34 more)

### Community 10 - "jobValidation.ts"
Cohesion: 0.09
Nodes (44): deleteWidgetFileIfExists(), uploadWidgetFile(), CreateNewsDto, NewsCtaDto, NewsMediaOutDto, NewsOutDto, PublicNewsDetailOutDto, PublicNewsListItemOutDto (+36 more)

### Community 11 - "job.dto.ts"
Cohesion: 0.07
Nodes (38): SubmitWidgetAiFeedbackDto, WidgetAiFeedbackOutDto, WidgetAnalyticsSummaryOutDto, WidgetCsatCommentDto, WidgetCsatSummaryDto, WidgetUsageNamedCountDto, WidgetVisitOutDto, WIDGET_AI_FEEDBACK_TRIGGERS (+30 more)

### Community 12 - "dependencies"
Cohesion: 0.10
Nodes (21): bcrypt, cors, express, @getbrevo/brevo, jsonwebtoken, multer, dependencies, bcrypt (+13 more)

### Community 13 - "JobWorkerService"
Cohesion: 0.06
Nodes (28): AgentInfluenceArticleDto, AgentInfluenceChunkDto, AgentInfluenceDeclaredToolDto, AgentInfluenceDto, AgentInfluenceGuidanceDto, AgentInfluenceToolDto, AgentInfluenceTopicDto, AgentToolUiEvent (+20 more)

### Community 14 - "modelRegistry.ts"
Cohesion: 0.10
Nodes (24): DeepseekChatRequest, DeepseekChatRole, DeepseekChunk, DeepseekClient, DeepseekClientConfig, DeepseekDelta, DeepseekMessage, DeepseekTool (+16 more)

### Community 15 - "jobWorkerService.ts"
Cohesion: 0.12
Nodes (24): BookMeetingConflictDto, BookMeetingSuccessDto, MeetingFieldValueDto, MeetingAvailabilityDto, MeetingAvailabilityWindowDto, MeetingBookingFieldDto, MeetingFieldConfigDto, MeetingSlotDto (+16 more)

### Community 16 - "jsonOutputGuard.ts"
Cohesion: 0.09
Nodes (12): CreateGuidanceDto, GuidanceAgentItemDto, GuidanceOutDto, UpdateGuidanceDto, GuidanceInterface, GuidanceModel, guidanceSchema, EntitlementService (+4 more)

### Community 17 - "tsconfig.json"
Cohesion: 0.18
Nodes (10): dist, **/*.ts, @tsconfig/node22/tsconfig.json, compilerOptions, forceConsistentCasingInFileNames, outDir, rootDir, exclude (+2 more)

### Community 18 - "ollamaClient.ts"
Cohesion: 0.13
Nodes (18): DEFAULTS, nextDelta(), OllamaChatOptions, OllamaChatRequest, OllamaChatResponse, OllamaClient, OllamaClientConfig, OllamaEmbedResponse (+10 more)

### Community 19 - "JobService"
Cohesion: 0.06
Nodes (60): BatchTestGroupDetailOutDto, BatchTestGroupOutDto, BatchTestGroupProgressDto, BatchTestGroupProgressOutDto, BatchTestQuestionExecutionDto, BatchTestQuestionOutDto, BulkBatchTestQuestionIdsDto, CreateBatchTestGroupDto (+52 more)

### Community 20 - "OllamaClient"
Cohesion: 0.20
Nodes (15): deleteArticleFileIfUnused(), CreateSnippetDto, SnippetOutDto, UpdateSnippetDto, ChunkModel, TopicModel, snippetOut(), SnippetService (+7 more)

### Community 21 - "widget.model.ts"
Cohesion: 0.25
Nodes (7): WidgetInterface, widgetChatSettingsSchema, widgetFaqEntrySchema, widgetFaqSettingsSchema, widgetHomeSettingsSchema, widgetSchema, widgetSectionSettingsSchema

### Community 22 - "PUBLIC_CAPABILITIES"
Cohesion: 0.14
Nodes (6): ChatAnalyticsController, LiveAgentController, parseAnalyticsRouteId(), parseCategoryRouteId(), statusForMessage(), parseLiveAgentRouteId()

### Community 23 - "deepseekClient.ts"
Cohesion: 0.11
Nodes (27): jszip, jszip, ArticleDetailOutDto, ArticleSyncStatus, CreateArticleDto, ExportArticleOutDto, ImportArticleDto, PublicArticleTopicOutDto (+19 more)

### Community 24 - "WidgetService"
Cohesion: 0.13
Nodes (16): ChatSessionOutDto, WidgetOutDto, ChatSessionModel, chatSessionSchema, chatSessionVisitorSchema, Widget, alignExpiredAtWithVisitor(), assertOwnedApiKey() (+8 more)

### Community 25 - "articleBucket.ts"
Cohesion: 0.06
Nodes (64): deleteArticleFile(), Bucket, buckets, deleteAllFilesForApiKey(), deleteFile(), deleteFileIfExists(), findFile(), findOwnedFile() (+56 more)

### Community 26 - "widget.service.ts"
Cohesion: 0.11
Nodes (37): UpdateWidgetDto, BUTTON_TEXT_ALIGN_VALUES, ButtonTextAlign, HOME_SECTION_TYPE_VALUES, HomeFaqElement, HomeFaqEntry, HomeGoToChatElement, HomeLatestNewsElement (+29 more)

### Community 27 - "widget.controller.ts"
Cohesion: 0.18
Nodes (7): parseArticleIdParam(), parseMediaIdParam(), parsePublicKeyParam(), parseSessionIdParam(), WidgetController, parseBindVisitorIdentityDto(), parseCreatePublicChatSessionDto()

### Community 28 - "message.interface.ts"
Cohesion: 0.11
Nodes (29): ChatAnalyticsInterface, chatAnalyticsSchema, ChatMessageInterface, MESSAGE_CONTENT_BLOCK_TYPES, MESSAGE_ROLES, MessageArticleBlock, MessageChunkBlock, MessageContentBlock (+21 more)

### Community 29 - "agent.graph.ts"
Cohesion: 0.11
Nodes (39): normalizeAgentToolNameKey(), AgentPipelineEvent, auditFailTool(), auditOkTool(), auditToolArgs(), completeChat(), decideRetrieval(), extractJsonObject() (+31 more)

### Community 30 - "widgetValidation.ts"
Cohesion: 0.13
Nodes (21): CreateVisitorLiveAgentTicketDto, ListAgentTicketsQuery, LiveAgentTicketAiContextTurnDto, LiveAgentTicketRatingDto, PostLiveAgentTicketMessageDto, SubmitLiveAgentTicketRatingDto, LIVE_AGENT_TICKET_STATUSES, LiveAgentTicketAiContextTurn (+13 more)

### Community 31 - "agent.service.ts"
Cohesion: 0.13
Nodes (29): AgentTurnEvent, LlmChatRole, AgentExecutionMode, deleteMemoriesForSession(), textFromMessage(), toLlmHistory(), meetingBookingMarkerRe(), stripModelLeakTags() (+21 more)

### Community 32 - "mcp.interface.ts"
Cohesion: 0.07
Nodes (58): CreateMcpDto, McpAuthenticationPublic, McpAuthPublicConfig, McpOutDto, McpSyncResultDto, McpToolOutDto, UpdateMcpDto, UpdateMcpToolDto (+50 more)

### Community 33 - "plan.service.ts"
Cohesion: 0.13
Nodes (11): ApiResponseDto, requireAdmin(), adminController, router, upload, AppConfigController, appConfigController, router (+3 more)

### Community 34 - "AppConfigService"
Cohesion: 0.21
Nodes (4): AppConfigInterface, AppConfigModel, appConfigSchema, AppConfigService

### Community 36 - "job.dto.ts"
Cohesion: 0.14
Nodes (26): ChatSessionInterface, ChatSessionVisitor, ChatSessionVisitorAuthMode, WIDGET_MEDIA_TYPE_VALUES, ArticleDoc, chatOrDefault(), faqOrDefault(), homeOrDefault() (+18 more)

### Community 37 - "mail.service.ts"
Cohesion: 0.23
Nodes (5): env, escapeHtml(), layout(), mailer, MailService

### Community 38 - "createLlmProvider.ts"
Cohesion: 0.15
Nodes (21): CreateMeetingTopicDto, MeetingTopicOutDto, UpdateMeetingTopicDto, meetingTopicToolName(), migrateWeeklyHoursToSchedule(), resolveWeeklySchedule(), addDaysYmd(), CandidateSlot (+13 more)

### Community 39 - "logger.ts"
Cohesion: 0.27
Nodes (4): Otpinterface, OtpModel, otpSchema, OtpService

### Community 40 - "AdminService"
Cohesion: 0.15
Nodes (14): ArticleFileResult, computePhash(), deleteAllArticleFilesForApiKey(), deleteArticleFileIfExists(), findArticleFile(), findOwnedArticleFile(), findSimilarArticleFile(), getArticleBucket() (+6 more)

### Community 41 - ".chunkArticle"
Cohesion: 0.09
Nodes (25): ChunkInterface, chunkSchema, TOPIC_SYNC_VALUES, TOPIC_TYPE_VALUES, TopicInterface, TopicSyncStatus, TopicType, topicSchema (+17 more)

### Community 42 - "topicValidation.ts"
Cohesion: 0.14
Nodes (10): AdminUserOutDto, UpdateAdminUserDto, CreatePlanDto, UpdatePlanDto, AppConfigPayload, AdminService, UpdateAppConfigInput, ChangeAppLogoInput (+2 more)

### Community 43 - "UserModel"
Cohesion: 0.23
Nodes (9): authenticateLiveAgent(), apiKeySchema, LiveAgentInterface, liveAgentSchema, UserInterface, userSchema, Express, Request (+1 more)

### Community 44 - "agent.memory.ts"
Cohesion: 0.27
Nodes (8): AgentMemoryInterface, AgentMemoryModel, agentMemorySchema, applyMemoryUpdates(), listMemories(), MemoryDoc, MemoryUpdates, normalizeKey()

### Community 45 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, dev, format, format:check, lint, lint:fix, start (+2 more)

### Community 46 - "OllamaClient"
Cohesion: 0.18
Nodes (7): BatchTestController, MeetingToolController, parseApiKeyIdQuery(), parseBatchTestGroupId(), parseBatchTestQuestionId(), parseParam(), parseReorderTopicsDto()

### Community 47 - "package.json"
Cohesion: 0.25
Nodes (7): author, description, keywords, license, name, type, version

### Community 48 - "topic.model.ts"
Cohesion: 0.11
Nodes (19): PublicArticleDetailOutDto, BindVisitorIdentityDto, ChatSessionVisitorOutDto, CreatePublicChatSessionDto, HomeSectionElementDto, PublicChatMessageOutDto, PublicChatMessagesOutDto, PublicFaqArticleOutDto (+11 more)

### Community 49 - "@langchain/langgraph"
Cohesion: 0.16
Nodes (18): ApiKeyCollaborationInviteInterface, ApiKeyCollaborationInviteModel, apiKeyCollaborationInviteSchema, defaultCollaboratorPermissions(), ApiKeyCollaborationInviteService, ApiKeySummary, buildCollaborationInviteUrl(), claimInvite() (+10 more)

### Community 50 - "sharp-phash"
Cohesion: 0.17
Nodes (15): BookMeetingDto, BookMeetingResultDto, MeetingOutDto, SessionMeetingFactDto, MeetingModel, isDuplicateKeyError(), MeetingDoc, meetingEndsAt() (+7 more)

### Community 51 - "zod"
Cohesion: 0.21
Nodes (8): LiveAgentTicketController, parsePublicKey(), parseCreateVisitorLiveAgentTicketDto(), parseListAgentTicketsQuery(), parseLiveAgentTicketId(), parsePostLiveAgentTicketMessageDto(), parseSessionIdQuery(), parseSubmitLiveAgentTicketRatingDto()

### Community 52 - "chatAnalytics.service.ts"
Cohesion: 0.15
Nodes (13): ChatAnalyticsConversationOutDto, AnalyticsCategoryInterface, SYSTEM_ANALYTICS_CATEGORY_SEEDS, analyticsCategorySchema, ChatMessageModel, AnalyzeCompletedTurnInput, applyToolOutcomeOverride(), CategoryDoc (+5 more)

### Community 54 - "requireApiKeyAccess.ts"
Cohesion: 0.20
Nodes (18): ApiKeyAccess, ApiKeyAccessRole, ApiKeyIdResolver, ApiKeySummary, attachApiKeyAccess(), hasApiKeyPermission(), json(), loadApiKeyAccess() (+10 more)

### Community 55 - "bcrypt"
Cohesion: 0.24
Nodes (8): readBearer(), requireAuth(), requireLiveAgent, canLiveAgent, imageUpload, liveAgentController, router, ticketController

### Community 56 - "chatAnalytics.controller.ts"
Cohesion: 0.20
Nodes (16): ChatAnalyticsConversationMessageOutDto, ChatAnalyticsRecordsPageOutDto, ChatAnalyticsTrendSeriesOutDto, ChatAnalyticsTrendsOutDto, CreateAnalyticsCategoryDto, UpdateAnalyticsCategoryDto, GAP_TYPE_SET, MESSAGE_TYPE_SET (+8 more)

### Community 57 - "ChatAnalyticsService"
Cohesion: 0.23
Nodes (8): AnalyticsCategoryOutDto, ChatAnalyticsRecordOutDto, AnalyticsCategoryModel, ChatAnalyticsModel, AnalyticsDoc, ChatAnalyticsService, toCategoryOutDto(), toRecordOutDto()

### Community 58 - "agent.state.ts"
Cohesion: 0.19
Nodes (11): MemoryEntry, AgentResolvedReferences, AgentResolvedToolCall, AgentResolvedTopicRef, AgentTurnState, RetrievedChunk, DeclaredAgentTool, fromLlmImageHandles() (+3 more)

### Community 59 - "meetingTool.ts"
Cohesion: 0.23
Nodes (18): MEETING_FIELD_TYPE_VALUES, defaultLabelForType(), isBreakInsideWindows(), isValidIanaTimezone(), parseAvailabilityWindow(), parseBlackoutDate(), parseBoolean(), parseFieldConfig() (+10 more)

### Community 60 - "apiKeyCollaborator.service.ts"
Cohesion: 0.29
Nodes (10): ApiKeyCollaboratorOutDto, CreateApiKeyCollaboratorDto, UpdateApiKeyCollaboratorDto, CollaboratorPermissions, ApiKeyCollaboratorModel, ApiKeyCollaboratorDoc, ApiKeyCollaboratorService, findDoc() (+2 more)

### Community 61 - "apiKeyCollaborator.controller.ts"
Cohesion: 0.21
Nodes (7): ApiKeyController, ApiKeyCollaboratorController, parseRouteId(), parseBoolean(), parseCollaboratorPermissions(), parseCollaboratorUserId(), requireUserId()

### Community 62 - "user.service.ts"
Cohesion: 0.18
Nodes (9): UserPlanOutDto, UserController, AuthorshipDoc, PopulatedUserDoc, toAdminUserOutDto(), toUserPlanOutDto(), UserPlanDoc, UserService (+1 more)

### Community 63 - "parseApiKeyId"
Cohesion: 0.18
Nodes (6): apiKeyIdFromParam(), resolveApiKeyIdFromRequest(), multerFile(), NewsController, parseApiKeyId(), parseNewsId()

### Community 64 - "buildLlmMessages"
Cohesion: 0.20
Nodes (15): buildLlmMessages(), formatGuidances(), formatRetrievedContext(), imageHandleSources(), prepareMessages(), clockContextPrompt(), conversationResolvedPrompt(), imageHandlesPrompt() (+7 more)

### Community 65 - "plan.service.ts"
Cohesion: 0.28
Nodes (7): PlanOutDto, PlanInterface, PlanModel, PlanSchema, PlanDoc, PlanService, toPlanOutDto()

### Community 66 - "apiKeyCollaborator.interface.ts"
Cohesion: 0.16
Nodes (10): AccessMod, ApiKeyModelType, CollaboratorServiceMod, fakeRes(), run(), API_KEY_PERMISSION_VALUES, ApiKeyCollaboratorInterface, COLLABORATOR_PERMISSION_DEFAULTS (+2 more)

### Community 67 - "MeetingToolService"
Cohesion: 0.24
Nodes (5): EnabledMeetingTopicForAgent, MeetingBookingPayloadDto, MeetingTopicListOutDto, MeetingTopicModel, MeetingToolService

### Community 68 - "guidance.controller.ts"
Cohesion: 0.27
Nodes (6): GuidanceController, parseContent(), parseCreateGuidanceDto(), parseGuidanceRouteId(), parseTitle(), parseUpdateGuidanceDto()

### Community 69 - "socket.ts"
Cohesion: 0.24
Nodes (12): LIVE_AGENT_SOCKET_EVENTS, LiveAgentSocketEvent, queueRoom(), ticketRoom(), AgentAuth, authenticateSocket(), emitToQueue(), getIo() (+4 more)

### Community 70 - "ChatAnalyticsDailyModel"
Cohesion: 0.26
Nodes (6): ChatAnalyticsSummaryOutDto, ChatAnalyticsDailyInterface, ChatAnalyticsDailyModel, chatAnalyticsDailySchema, mapToRecord(), utcDayStart()

### Community 71 - "topic.ts"
Cohesion: 0.27
Nodes (10): CreateTopicDto, ReorderTopicsDto, UpdateTopicDto, legacyArrayToBlocks(), mediaIdsFromBlocks(), mediaIdToString(), optionalAlt(), parseCreateTopicDto() (+2 more)

### Community 73 - "requireUser"
Cohesion: 0.18
Nodes (8): requireUser, agentController, router, inviteController, router, canTrainGuidance, guidanceController, router

### Community 75 - "apiKeyCollaborationInvite.controller.ts"
Cohesion: 0.29
Nodes (5): AcceptApiKeyCollaborationInviteOutDto, CollaborationInviteAcceptRole, CreateApiKeyCollaborationInviteOutDto, ApiKeyCollaborationInviteController, parseCollaborationInviteToken()

### Community 76 - "meetingTool.model.ts"
Cohesion: 0.22
Nodes (7): MeetingTopicInterface, meetingAvailabilityWindowSchema, meetingFieldSchema, meetingTimeRangeSchema, meetingTopicSchema, weeklyDayScheduleSchema, weeklyHourSchema

### Community 77 - "meetingTool.controller.ts"
Cohesion: 0.33
Nodes (6): parseMeetingTopicIdQuery(), parsePublicKey(), parseSessionIdQuery(), parseAvailabilityRangeQuery(), parseBookMeetingDto(), parseCreateMeetingTopicDto()

### Community 78 - "UserModel"
Cohesion: 0.50
Nodes (7): addDeepseekTokens(), canUseDeepseek(), nextDeepseekUsage(), shouldUseDeepseek(), usedThisMonth(), utcUsageMonth(), UserModel

### Community 79 - ".sendOtp"
Cohesion: 0.29
Nodes (3): SendOtpInDto, encodeResetToken(), ResetTokenPayload

### Community 80 - "article.route.ts"
Cohesion: 0.29
Nodes (6): articleController, canTrainArticles, imageUpload, importUpload, requireTrain, router

### Community 81 - "widget.route.ts"
Cohesion: 0.29
Nodes (6): canWidget, imageUpload, meetingToolController, router, ticketController, widgetController

### Community 82 - "fetchRemoteImage.ts"
Cohesion: 0.67
Nodes (6): assertPublicResolvedHost(), fetchRemoteImageBuffer(), isBlockedHostname(), isPrivateIpv4(), isPrivateIpv6(), parseImageUrl()

### Community 83 - "apiKey.ts"
Cohesion: 0.62
Nodes (6): parseBoolean(), parseCreateApiKeyDto(), parseDescription(), parseIpAllowlist(), parseLabel(), parseUpdateApiKeyDto()

### Community 84 - "plan.ts"
Cohesion: 0.71
Nodes (6): parseAccentColor(), parseBoolean(), parseCreatePlanDto(), parseNumber(), parseString(), parseUpdatePlanDto()

### Community 85 - "jwt.ts"
Cohesion: 0.33
Nodes (5): authenticateByToken(), AccessTokenPayload, LiveAgentTokenPayload, signAccessToken(), verifyAccessToken()

### Community 86 - "apiKey.route.ts"
Cohesion: 0.33
Nodes (5): apiKeyController, collaboratorController, inviteController, requireOwner, router

### Community 87 - "apiKeyCollaborator.service.test.ts"
Cohesion: 0.33
Nodes (5): ApiKeyModelType, ApiKeyServiceMod, CollabModelType, CollabServiceMod, UserModelType

### Community 88 - "snippet.route.ts"
Cohesion: 0.33
Nodes (5): canTrainSnippets, imageUpload, requireTrain, router, snippetController

### Community 89 - "batchTest.route.ts"
Cohesion: 0.50
Nodes (3): batchTestController, canTest, router

### Community 90 - "guidance.service.test.ts"
Cohesion: 0.50
Nodes (3): GuidanceModelType, GuidanceServiceMod, UserServiceMod

### Community 91 - "mcp.route.ts"
Cohesion: 0.50
Nodes (3): canMcp, mcpController, router

## Knowledge Gaps
- **313 isolated node(s):** `name`, `version`, `description`, `dev`, `start` (+308 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `jszip` connect `deepseekClient.ts` to `dependencies`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `deepseekClient.ts`, `mongoose`, `@modelcontextprotocol/client`, `package.json`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Why does `ArticleService` connect `article.service.ts` to `job.dto.ts`, `apiKey.service.ts`, `AdminService`, `OllamaClient`, `deepseekClient.ts`, `agent.graph.ts`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _313 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `article.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14408602150537633 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `entitlement.service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07928118393234672 - nodes in this community are weakly interconnected._