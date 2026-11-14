<!-- doc
id: reference-modules
reader: 接手代码的人、reviewer
fact-source: src/*.mjs、index.js 的文件与 export 扫描（scripts/gen-docs.mjs 生成）
checked: generated
rot-if: 新增/删除模块或测试（重新生成即可）
-->

# 模块清单（自动生成）

> 生成命令：`npm run docs:gen`。110 个模块、15450 行。
> **无同名测试**的模块：41 个 —— 这是待补清单，不是失败项。
> "同名测试"按 `tests/*<模块名>*.test.mjs` 匹配，只说明"有测试提到它"，不保证覆盖。

| 模块 | 行数 | 导出 | 同名测试 |
|---|---|---|---|
| `src/studio-controller.mjs` | 1056 | createStudioController | **无** |
| `src/sidebar-editing.mjs` | 936 | EDITING_LABEL, installWorkspaceSwitch | `sidebar-editing-rows.test.mjs` |
| `src/studio-proxy.mjs` | 852 | startStudioProxy | `studio-proxy-files.test.mjs` |
| `src/acp-agent-service.mjs` | 561 | catalogFromConfigOptions, createAcpAgentService | `acp-agent-service.test.mjs` |
| `src/official-facade.mjs` | 506 | officialFacadeSource | `official-facade-events.test.mjs` |
| `src/login-page.mjs` | 440 | createLoginPage | **无** |
| `src/workbench-auth.mjs` | 392 | DEFAULT_WORKBENCH_BASE_URL, createWorkbenchAuth, parseAuthActionBody | `workbench-auth.test.mjs` |
| `src/studio-panel.mjs` | 370 | createStudioPanel, templateProjectUrl | **无** |
| `src/preferences.mjs` | 263 | balanceCachePatch, balanceFromPrefs, clearBalanceCachePatch, createPreferencesStore, onboardingCopy, productMeta | `preferences-custom.test.mjs`、`preferences.test.mjs` |
| `src/tool-installer.mjs` | 256 | TOOL_SOURCES, createToolInstaller, readTarMember | `tool-installer.test.mjs` |
| `src/transcribe-service.mjs` | 255 | CACHE_VERSION, createTranscribeService, fingerprint | **无** |
| `src/acp-client.mjs` | 251 | createAcpClient, resolveAcpCommand | `acp-client.test.mjs` |
| `src/studio-controller/routes/editing.mjs` | 249 | createEditingRoutes | **无** |
| `src/official-permission.mjs` | 237 | FULL_ACCESS, PROJECT_PERMISSIONS_DOMAIN, WORKSPACE_WRITE, openProjectPermissions | `official-permission.test.mjs` |
| `src/captcha-challenge.mjs` | 236 | createCaptchaChallenge | **无** |
| `src/client-entry.js` | 197 | — | **无** |
| `src/tool-call-act.mjs` | 197 | describeToolCall, parseArguments, planFromTodoWrite | `tool-call-act.test.mjs` |
| `src/official-chat-store.mjs` | 181 | OFFICIAL_CHAT_DOMAIN, OFFICIAL_CHAT_MAX_BYTES, openOfficialChatStore | `official-chat-store-delete.test.mjs` |
| `src/cli-tool.mjs` | 180 | cliArguments, createCliTool, resolveCli | `export-cli-tool.test.mjs` |
| `src/studio-runtime.mjs` | 170 | OPENFILM_VERSION, createStudioRuntime, loadPinnedStudio | `studio-runtime.test.mjs` |
| `src/studio-entry.js` | 169 | — | **无** |
| `src/studio-debug-redirect.mjs` | 168 | startLocalConsole | `studio-debug-redirect.test.mjs` |
| `src/clip-tool.mjs` | 167 | MAX_CLIP_BYTES, MAX_CLIP_OPERATIONS, createClipTool, filmIdentity | `clip-tool.test.mjs` |
| `src/transcribe-tool.mjs` | 167 | createTranscribeTool | `transcribe-tool.test.mjs` |
| `src/studio-debug.mjs` | 162 | redeemStudioSession, startStudioDebug | `studio-debug-redirect.test.mjs`、`studio-debug-theme.test.mjs` |
| `src/project-files.mjs` | 161 | PROJECT_ID, createProjectFiles, openCommand, projectFileError, projectFilePath, relativeProjectPath | `project-files.test.mjs` |
| `src/frame-tool.mjs` | 159 | createFrameTool | **无** |
| `src/mcp-server.mjs` | 159 | MCP_PROTOCOL_VERSION, createMcpEndpoint, createMcpTokens, mcpServerEntry | `mcp-server.test.mjs` |
| `src/asr-models.mjs` | 158 | SENSE_VOICE, ensureModels, libraryCacheRoot, modelState, modelsRoot, senseVoiceDir… | `asr-models.test.mjs` |
| `src/official-templates.mjs` | 157 | installTemplate, listTemplates | `official-templates.test.mjs` |
| `src/asr-pipeline.mjs` | 156 | TRANSCRIBE_LIMITS, assembleTranscript, createTranscribePipeline | `asr-pipeline.test.mjs` |
| `src/timeline-operations.mjs` | 142 | TimelineEditError, applyTimelineOperations | `timeline-operations.test.mjs` |
| `src/asr-audio.mjs` | 140 | TARGET, extractPcm, parseProbeOutput, probeMedia, resolveFfmpeg, runFfmpeg | `asr-audio.test.mjs` |
| `src/official-chat-rpc.mjs` | 140 | createOfficialChatRpc | `official-chat-rpc.test.mjs` |
| `src/auth-bridge.mjs` | 134 | dispatchAuthAction, registerAuthBridge | **无** |
| `src/workspace-archive.mjs` | 131 | createArchiveWatcher | `workspace-archive.test.mjs` |
| `src/login-remember.mjs` | 124 | createLoginRememberStore | `login-remember.test.mjs` |
| `src/asr-wav.mjs` | 123 | openWav, parseWavHeader | `asr-wav.test.mjs` |
| `src/official-project-scope.mjs` | 122 | OfficialProjectScope | **无** |
| `src/asr-silence.mjs` | 119 | createSilenceSegmenter, findSpeechRuns, percentile, rmsOf | `asr-silence.test.mjs` |
| `src/editing-prefs.mjs` | 118 | createEditingPrefs | `editing-prefs.test.mjs` |
| `src/film-tool.mjs` | 118 | createFilmTool, exportReadiness, summarizeFilm | **无** |
| `src/official-approvals.mjs` | 118 | createOfficialApprovals | **无** |
| `src/project-core.mjs` | 118 | FILM_DOC_SHA256, createProjectCore | `project-core.test.mjs` |
| `src/film-draft.mjs` | 116 | draftFilm | `film-draft.test.mjs` |
| `src/plugin-log.mjs` | 116 | createPluginLog, redact | `plugin-log.test.mjs` |
| `src/export-tool.mjs` | 115 | blockedBy, createExportTool, exportAsk | **无** |
| `src/official-event-stream.mjs` | 113 | attachOfficialEventStream | `official-event-stream.test.mjs` |
| `src/asr-text.mjs` | 112 | countChars, formatTimecode, ribbonTimes, round3, splitSentences, textWeight… | `asr-text.test.mjs` |
| `src/film-operations.mjs` | 109 | MAX_FILM_BYTES, createFilmOperations | `film-operations.test.mjs` |
| `src/studio-controller/routes/system.mjs` | 107 | createSystemRoutes | **无** |
| `src/assets-tool.mjs` | 105 | createAssetsTool, flattenFiles | `assets-tool.test.mjs` |
| `src/studio-library-mirror.mjs` | 104 | SENSE_VOICE_PATHS, ensureStudioLibraryMirror | `studio-library-mirror.test.mjs` |
| `src/studio-proxy/upstream.mjs` | 103 | COMMAND_FAILURE, RESPONSE_HEADERS, SAFE_HEADERS, ancestorsFor, fail, friendlyCommandFailure… | **无** |
| `src/bridge-trace.mjs` | 99 | createBridgeTrace | `bridge-trace.test.mjs` |
| `src/studio-http.mjs` | 98 | createStudioHttp | `studio-http.test.mjs` |
| `src/official-thinking.mjs` | 97 | AUTO, chooseEffort, effortsOf, modelEntry, thinkingOption | `official-thinking.test.mjs` |
| `src/brand.mjs` | 96 | brandCssVars, brandVersion, getBrand, replaceTitle, validateBrand | `brand.test.mjs` |
| `src/host-components.mjs` | 96 | createHostComponentDetector | `host-components.test.mjs` |
| `src/asr-segments.mjs` | 95 | SEGMENT_LIMITS, normalizeSegments, planSegments | `asr-segments.test.mjs` |
| `src/acp-profile-models.mjs` | 91 | activeProfileDir, applyAcpModelProviders, providerBlocks | `acp-profile-models.test.mjs` |
| `src/asr-sensevoice.mjs` | 89 | createSenseVoiceRecognizer, loadSherpa | **无** |
| `src/studio-controller/routes/diagnose.mjs` | 88 | createDiagnoseRoute | **无** |
| `src/get-tool.mjs` | 87 | createGetTool | **无** |
| `src/download-sources.mjs` | 86 | MODEL_BASES, MODEL_REPO, TOOL_SOURCES, augmentPath, knownBinaryDirs, modelBases… | `download-sources.test.mjs` |
| `src/theme.mjs` | 82 | THEME_SURFACES, createTheme, theme, themeSurfaceFor | `studio-debug-theme.test.mjs`、`theme-bake.test.mjs`、`theme-injection.test.mjs`、`theme.test.mjs` |
| `src/preset-report.mjs` | 80 | reportPresetStatus | `preset-report.test.mjs` |
| `src/project-trash.mjs` | 79 | TRASH_DIR, createProjectTrash | `project-trash.test.mjs` |
| `src/studio-controller/routes/bootstrap.mjs` | 76 | createBootstrapRoute | **无** |
| `src/studio-proxy-auth.mjs` | 76 | createStudioProxyAuth | **无** |
| `src/library-tool.mjs` | 74 | LIBRARY_KINDS, createLibraryTool | **无** |
| `src/timeline-layout.mjs` | 71 | layoutTimeline | `timeline-layout.test.mjs` |
| `src/session-save.mjs` | 66 | saveSessionFilm | `session-save.test.mjs` |
| `src/asr-refine.mjs` | 65 | REFINE_REASONS, buildRefinePrompt, parseRefineReply, refineTranscript | `asr-refine.test.mjs` |
| `src/film-summary.mjs` | 65 | summarizeFilm | `film-summary.test.mjs` |
| `src/studio-library-patch.mjs` | 64 | SENSE_VOICE_ABOUT, SENSE_VOICE_ID, SENSE_VOICE_MODEL, applyStudioLibraryPatch | `studio-library-patch.test.mjs` |
| `src/acp-session-store.mjs` | 62 | createAcpSessionStore | **无** |
| `src/editing-filter.mjs` | 60 | SESSION_FALLBACK, filterEditing, matchRange, normalizeQuery, projectDisplayTitle, sessionDisplayTitle | `editing-filter.test.mjs` |
| `src/archive-bridge.mjs` | 59 | registerArchiveBridge | **无** |
| `src/area-bus.mjs` | 59 | areaBus, createAreaBus | **无** |
| `src/shell-extras.mjs` | 58 | shellUiInjection, shellUiVersion | `shell-extras.test.mjs` |
| `src/studio-proxy/websocket.mjs` | 58 | MAX_FRAME, WS_GUID, frames, wsFrame | **无** |
| `src/project-instructions.mjs` | 57 | INSTRUCTIONS, ensureProjectInstructions | `project-instructions.test.mjs` |
| `src/workspace-create.mjs` | 57 | createWorkspaceFlow | **无** |
| `src/openfilm-prompt.mjs` | 51 | apply, inject | **无** |
| `src/template-bridge.mjs` | 50 | registerTemplateBridge | `template-bridge.test.mjs` |
| `src/studio-controller/router.mjs` | 47 | createRouter | **无** |
| `src/editing-project-delete.mjs` | 44 | createEditingProjectDelete | `editing-project-delete.test.mjs` |
| `src/official-event-hub.mjs` | 43 | createOfficialEventHub | **无** |
| `src/project-markers.mjs` | 41 | OPENED_MARKER, markProjectOpened | `project-markers.test.mjs` |
| `src/official-shell.mjs` | 40 | resolveOfficialShell | **无** |
| `src/draft-tool.mjs` | 38 | createDraftTool | `draft-tool.test.mjs` |
| `src/studio-controller/routes/diagnostics.mjs` | 38 | createDiagnosticsRoutes | **无** |
| `src/studio-controller/routes/assets.mjs` | 37 | createAssetRoutes | **无** |
| `src/panel-keepalive.mjs` | 36 | createActivationStore | `panel-keepalive.test.mjs` |
| `src/style-lab.mjs` | 36 | styleLabInjection, styleLabVersion | `style-lab.test.mjs` |
| `src/studio-controller/turns.mjs` | 35 | createTurnLog | **无** |
| `src/asr-media.mjs` | 34 | createMediaEdge | `asr-media.test.mjs` |
| `src/guide-tool.mjs` | 34 | createGuideTool | **无** |
| `src/official-model-catalog.mjs` | 34 | officialModelOptions | **无** |
| `src/studio-controller/routes/chat.mjs` | 34 | createChatRoutes | **无** |
| `src/auth-client.mjs` | 32 | authAction, authEndpoint | **无** |
| `src/dsh-ai.mjs` | 29 | createDshAskAgent | **无** |
| `src/editing-sessions.mjs` | 29 | buildEditingProjects | `editing-sessions.test.mjs` |
| `src/draft-session.mjs` | 24 | MAX_DRAFT_OPERATIONS, appendDraft, startDraft, undoDraft | `draft-session.test.mjs` |
| `src/official-attachment.mjs` | 20 | officialUploadSource | `official-attachment.test.mjs` |
| `src/studio-controller/http-body.mjs` | 15 | readJsonBody | **无** |
| `index.js` | 11 | apply, inject | `plugin-log.test.mjs` |
| `src/film-source.mjs` | 11 | MAX_SOURCE_BYTES, decodeFilmSource | `film-source.test.mjs` |
| `src/brand-assets.mjs` | 2 | BRAND_SYMBOL_COLOR_SVG, BRAND_SYMBOL_WHITE_SVG | **无** |

## 无同名测试

- `src/studio-controller.mjs`（1056 行）
- `src/login-page.mjs`（440 行）
- `src/studio-panel.mjs`（370 行）
- `src/transcribe-service.mjs`（255 行）
- `src/studio-controller/routes/editing.mjs`（249 行）
- `src/captcha-challenge.mjs`（236 行）
- `src/client-entry.js`（197 行）
- `src/studio-entry.js`（169 行）
- `src/frame-tool.mjs`（159 行）
- `src/auth-bridge.mjs`（134 行）
- `src/official-project-scope.mjs`（122 行）
- `src/film-tool.mjs`（118 行）
- `src/official-approvals.mjs`（118 行）
- `src/export-tool.mjs`（115 行）
- `src/studio-controller/routes/system.mjs`（107 行）
- `src/studio-proxy/upstream.mjs`（103 行）
- `src/asr-sensevoice.mjs`（89 行）
- `src/studio-controller/routes/diagnose.mjs`（88 行）
- `src/get-tool.mjs`（87 行）
- `src/studio-controller/routes/bootstrap.mjs`（76 行）
- `src/studio-proxy-auth.mjs`（76 行）
- `src/library-tool.mjs`（74 行）
- `src/acp-session-store.mjs`（62 行）
- `src/archive-bridge.mjs`（59 行）
- `src/area-bus.mjs`（59 行）
- `src/studio-proxy/websocket.mjs`（58 行）
- `src/workspace-create.mjs`（57 行）
- `src/openfilm-prompt.mjs`（51 行）
- `src/studio-controller/router.mjs`（47 行）
- `src/official-event-hub.mjs`（43 行）
- `src/official-shell.mjs`（40 行）
- `src/studio-controller/routes/diagnostics.mjs`（38 行）
- `src/studio-controller/routes/assets.mjs`（37 行）
- `src/studio-controller/turns.mjs`（35 行）
- `src/guide-tool.mjs`（34 行）
- `src/official-model-catalog.mjs`（34 行）
- `src/studio-controller/routes/chat.mjs`（34 行）
- `src/auth-client.mjs`（32 行）
- `src/dsh-ai.mjs`（29 行）
- `src/studio-controller/http-body.mjs`（15 行）
- `src/brand-assets.mjs`（2 行）

