# 0.4.0 改造清单（待确认）

> 依据：本机实测证据（2026-11-10）。每一条改动都标了文件、验收和风险；标「待复现」的是推论，不写成结论。
> 你确认后我按 §5 的顺序开工。

---

## 0. 结论先行

你截图里的 `agent:prompt — [HTTP 503] /__dsh/official-rpc` + `OFFICIAL_AGENT_NOT_STARTED`，
**不是网络问题，也不是模型问题**，是"这套项目绑定的 DSH 会话已经被归档了，而插件不知道，还在往里面发消息"。

四层证据（都可复查）：

1. **四个项目的会话绑定，全部指向已归档会话**（`~/.dsh/storages/no996_openfilm_project_conversations/projects/*.json` × `~/.dsh/storages/workspace.json` 的 `archivedSessionIds`）：

   | 项目 | 绑定会话 | 状态 |
   |---|---|---|
   | `bhJSN-AImZpS` | `session-7c275041…` | **ARCHIVED** |
   | `eA6ylpT2qnwP` | `session-67c1fec2…` | **ARCHIVED** |
   | `v52hOPySYSpE` | `session-c48c93ca…` | **ARCHIVED** |
   | `xQZDxc4D1q2m` | `session-9ca6955d…` | **ARCHIVED** |

2. **真实帧证明这一轮 20 毫秒就被拦了**（`%TEMP%\dsh-openfilm-frames.jsonl`）：

   ```
   agent/inbox/spliced  … inserted[{content:[{text:"你好"}], source:{kind:"user", rpcId:"5da2ccba-…"}}]
   turn/start           turn:4
   agent/inbox/spliced  … removedCount:1
   turn/end             turn:4, reason:{kind:"blocked"}      ← 20ms 后，没有任何 assistant-stream
   ```

   DSH 的 `workspaceRegistry.archiveSession` 文档原话：*"the durable archive set is what a provider's `agent/pre-step` gate reads"* ——
   归档集合就是 `agent/pre-step` 门禁读的东西。所以**归档会话的每一次 prompt 都会以 `blocked` 立刻结束**。

3. **错误被翻译错了地方**：`turn/end` 分支要求 `operation.matched` 为真，而 `matched` 只在收到 `user/message`
   且 `source.rpcId` 匹配时才置位；但这一轮的准入事件是 `agent/inbox/spliced`（rpcId 在 `data.inserted[0].source.rpcId`）。
   于是 `matched=false` → 抛 `OFFICIAL_AGENT_CONFLICT('Unexpected turn end')` → 落进 catch 的
   `if (operation.admitted && … && !operation.matched) throw OFFICIAL_AGENT_NOT_STARTED`。
   页面只拿到错误码，真实的 `blocked` 被丢掉了。

4. **因此"频繁触发"是必然的**：绑定表里存的是 sessionId，`sessionExists()` 只校验存在/cwd/agentAvailable，
   **不校验归档状态**；失败也不进 `uncertain`（`matched` 为假），所以没有锁、没有恢复路径，用户每点一次发送就重来一遍。

**为什么我改几次都在这类地方翻车**（一并说清，免得再犯）：
桥接层只对"并发冲突的形状"做了防御，对"**终态原因**"是瞎的；两个错误码吞掉了所有早期失败；
发送前没有任何"这个会话还能不能用"的探针；测试里的夹具是自己编的 `user/message`，所以真实事件名对不上也测不出来。
这次的修法是：**发送前探针 + 真实帧夹具 + 把 `turn/end` 的任何 reason 都当成一等公民处理**。

---

## 1 P0：修 503（`OFFICIAL_AGENT_NOT_STARTED` / 归档会话）

### 1.1 改动

| 文件 | 改什么 |
|---|---|
| `src/workspace-archive.mjs`（新） | `createArchiveWatcher(ctx)`：`ctx.workspaceController.follow(signal)` 维护 `Set<sessionId>`，导出 `isArchived(id)`、`subscribe(fn)`；`workspaceController` 缺席时返回 `undefined` 能力（诊断里标注），不假装知道 |
| `src/project-conversation.mjs` | `sessionExists()` 增加归档判定：归档会话视为**不可用**（返回 `'archived'`），与"不存在/foreign"区分开，供上层给出不同文案 |
| `src/official-agent-service.mjs` | ① 发送前探针：`verify → ensure → archived?`，归档直接 `OFFICIAL_AGENT_CONVERSATION_ARCHIVED`（不进入 budget/冲突逻辑）；② 准入归因改为「`agent/inbox/spliced` 里 `inserted[].source.rpcId === requestId`」**或** `user/message` 二者其一；③ `turn/end` 在任何时刻都处理：`matched=false` 且 `reason.kind==='blocked'` → 终态 `OFFICIAL_AGENT_BLOCKED`（文案"会话已归档或被拦截"），不再抛 CONFLICT；④ catch 里再分一类：`blocked` 不算 uncertain（没有输出、没有副作用） |
| `src/official-agent-events.mjs` | 仅补注释与白名单（thinking 类型实测为 `reasoning-delta`，见 §2） |
| `src/studio-controller.mjs` | 装配 watcher；`/diagnose` 增加 `archive: {watched, archivedCount}`；`officialRpc` 把新错误码透传给页面 |
| `src/official-facade.mjs` | `rpc()` 已保留 Host 错误详情；补 `agent:archive-state` 通道给页面显示"已归档"状态 |

### 1.2 验收

- 归档项目点发送 → 面板出现明确文案「此项目的会话已归档」，**不再出现 503 错误码**；
- `%TEMP%\dsh-openfilm-frames.jsonl` 仍记录 `turn/end blocked`（诊断保留），但页面显示分类错误；
- 取消归档后同一条消息可正常发出、有流式回复；
- 新增测试：用 §0.2 的真实帧做夹具（`agent/inbox/spliced` → `turn/start` → `turn/end blocked`），断言最终错误码是 `OFFICIAL_AGENT_BLOCKED` 且 `uncertain` 未被写入。

### 1.3 风险

- `workspaceController` 在个别 profile 可能不存在（可选依赖）→ 必须"能力缺席"降级，不能静默放行或全隐藏；
- 改动碰到 `official-agent-service.mjs` 的准入/终态状态机，是本仓最危险的一段代码：先补夹具测试再动逻辑。

---

## 2 P0/P1：思考 + 工具调用真正显示在对话里

### 2.1 实测到的事实（不再靠猜）

**ACP 侧**（官方 shell 的消费形状，`vendor/official-shell/ui/assets/index-*.js`）：

| sessionUpdate | 期望字段 |
|---|---|
| `agent_message_chunk` | `content:{type:'text',text}` |
| `agent_thought_chunk` | 同上（只用于"思考中"状态） |
| `tool_call` | `toolCallId, title, kind, rawInput, locations?, content?` |
| `tool_call_update` | `toolCallId, status:'completed'\|'failed', content?, rawOutput?` |

**DSH 侧**（本次会话日志的真实事件，235 帧实测）：

```json
{"type":"tool/call","data":{"turn":1,"step":1,"callId":"call_00_…","name":"ops_glob","arguments":"{\"pattern\":[…]}"}}
{"type":"tool/result","data":{"turn":1,"step":1,"toolCallId":"call_00_…","message":{"role":"tool","content":[{"type":"text","text":"…"}]}}}
{"type":"assistant/message","data":{"turn":1,"step":1,"message":{"role":"assistant","content":[
  {"type":"reasoning","text":"…"},
  {"type":"tool-call","id":"call_00_…","name":"ops_glob", …},
  {"type":"text","text":"…"}]}}}
```
另有 `step/start`、`step/end`、`request/header`。
流式 chunk 名实测为 `text-delta` 与 `reasoning-delta`（harness 包内 66 / 56 次出现），`reasoning-delta` 已在 `THOUGHT` 白名单里——
**之前"思考无内容"很可能不是类型名错，而是这一轮被 `blocked`，根本没有 assistant-stream 可翻。**

### 2.2 映射表（要实现的）

| DSH 事件 | → ACP 事件 | 备注 |
|---|---|---|
| `tool/call`（`data.turn === candidate`） | `tool_call` | `toolCallId=callId`、`title=name`、`kind='other'`、`rawInput=arguments`；同一 callId 只发一次 |
| `tool/result` | `tool_call_update` | `status` 由 `message.content` 是否含错误判定 `completed`/`failed`；`content` 取文本块，`rawOutput` 截断 |
| `assistant/message` 的 `reasoning` 块 | `agent_thought_chunk` | 流式缺失时的兜底（同一 attempt 已流过的文本不重复） |
| `assistant/message` 的 `text` 块 | `agent_message_chunk` | 仅在流式没覆盖时兜底，按 `part` 去重 |
| `step/start` / `step/end` | 不发 | 只更新内部状态（用于"模型正在做什么"的第二步粒度） |
| `assistant-stream` chunk | 现状保留 | `text-delta`/`reasoning-delta` 继续走流式 |

### 2.3 改动

| 文件 | 改什么 |
|---|---|
| `src/official-agent-events.mjs` | 从"只翻 assistant-stream"扩成"事件 + chunk 两个入口"：`translateSessionEvent(state, {event})` 与现有 `translateOfficialAgentEvent`；新增 `toolCall` 去重表、内容截断（8 KiB/条）、错误分类 |
| `src/official-agent-service.mjs` | pump 里新增 `event.type === 'tool/call' \| 'tool/result' \| 'assistant/message' \| 'step/*'` 分支，按 `data.turn === candidate` 归属；工具事件不参与 matched 判定 |
| `src/official-facade.mjs` | 不变（已透传任意 `update`）；补一条"工具耗时"提示所需的 `time` 透传 |
| `tests/official-agent-events.test.mjs` | 用 §2.1 的真实 JSON 做夹具：call→update 成对、同 callId 去重、跨 turn 丢弃、超长截断、失败状态 |

### 2.4 验收

- 一条会调用工具的消息：对话里先出现"思考"，再出现工具卡片（名称 + 参数摘要 + 状态"运行中"），结束后变"完成/失败"，可展开结果摘要；
- 工具调用**不**混进正文文本，正文不重复；
- 取消/失败时卡片保持最后状态，不假完成；
- 测试覆盖 call/result/去重/turn 过滤。

### 2.5 风险

- 工具结果可能很大且含私有路径：只截断 + 只回给本机页面，不落外部存储；
- `assistant/message` 与流式文本可能双发 → 必须按 `(turn, step, part)` 去重，否则用户看到两遍。

---

## 3 P1：归档与 DSH 侧边栏**同一份真相**

### 3.1 DSH 的真实模型（已查证的服务契约）

- `ctx.workspaceController.follow(signal)` → `baseline` 含 `archivedSessionIds`，增量帧有 `{type:'archived', archivedSessionIds}`；
- `archiveSession({sessionId, stopActivity?})` / `unarchiveSession({sessionId})` 返回完整归档集合；
- `sessionController.list()` 的 `SessionSummary` **没有** archived 字段 → 归档只能从 workspace 侧读。

### 3.2 语义（我建议的口径，需要你确认）

1. **同一个集合，不建第二份真相**：插件不再自己记"哪些会话归档了"，一律读 DSH 的归档集合；
2. **双向**：DSH 侧边栏归档 → 视频面板的项目对话同步消失；视频面板归档 → DSH 侧边栏也消失（调同一个 `archiveSession`）；
3. **可逆、不删除**：归档≠删除，永远不删会话/项目/素材；恢复 = `unarchiveSession`；
4. **区分三件事**（这正是你说的"要区分一下"）：
   - **归档**：从列表消失，可恢复；
   - **重绑**：项目换一个**新**会话（旧的保持归档、不删不改）；
   - **删除**：本插件不提供。
5. **运行中的会话**：显式点归档时带 `stopActivity:true`（会请求停止当前工作），与 DSH 侧边栏行为一致；无确认弹窗不静默停。

### 3.3 改动

| 文件 | 改什么 |
|---|---|
| `src/workspace-archive.mjs`（同 §1） | 提供 `archivedIds()`、`isArchived()`、`archive(id,{stopActivity})`、`unarchive(id)`、`subscribe()` |
| `src/official-chat-store.mjs` | `load()` 返回的 sessions 过滤掉归档项；`saveTurn` 对归档项目拒写（`CHAT_ARCHIVED`），避免"归档后还在长历史" |
| `src/official-chat-rpc.mjs` | 新增通道 `chat:archive`、`chat:unarchive`、`chat:archive-state`；沿用严格 payload 校验（`exact()`） |
| `src/official-facade.mjs` | `chat.archive(project)` / `chat.unarchive(project)` / `chat.archiveState(project)`；`chat.load` 结果里带 `archived:true/false` |
| `src/project-conversation.mjs` | 归档绑定不自动换绑；`resolve()` 返回 `archived` 标记，由上层决定（见 §7 决策 A） |
| `src/studio-panel.mjs` / 官方 shell 侧 | 面板/对话页显示"已归档"徽标 + "恢复"按钮；不新增自建列表，避免两套界面 |

### 3.4 验收

- DSH 侧边栏归档某视频会话 → 刷新视频面板：该项目的对话消失/显示已归档，发送被拒并给出"恢复"入口；
- 在视频面板点归档 → DSH 侧边栏同样消失；点恢复 → 两边同时回来；
- 归档后历史仍在磁盘：`chat:load` 恢复后能看到归档前内容；
- 归档运行中的会话：先停工作再归档，不出现"有输出但被归档"的错位；
- 测试：用假 `workspaceController`（`follow` 推 baseline + archived 帧）验证过滤与双向调用。

### 3.5 风险

- `stopActivity` 会打断用户正在跑的回合 → 必须只由显式动作触发；
- 过滤逻辑若读不到 controller（能力缺席）→ 宁可不隐藏并在诊断里报 `archive: unavailable`，也不要凭猜测隐藏。

---

## 4 附带项：预设根本没注册（影响工具面）

`%TEMP%\dsh-openfilm-preset.json`（20:06 写入）：

```json
{"registered":false,"ok":false,"detail":"preset row not registered",
 "presets":["cordis","minimal","ptc","quick","standard"]}
```

而两个视频会话的 header 里 `agentPreset` 都是 `"quick"`。
即：`openfilm-video-editing` 这一行在 **Loader 层没有挂上**，会话退回了默认预设——
这会让 §2 的工具卡片看起来"更正常"，但视频剪辑的 scoped prompt / 工具集其实没生效。
列进本版：查 `cordis.patch.yml` 的预设行为什么没被接受（先看 `preset.json` 的 `raw/presets`，再核 preset 插件清单里是否有必填项缺失），目标是把 `registered` 变 true；不改预设语义。

---

## 5 顺序、依赖与规模

| 步 | 内容 | 依赖 | 预估 |
|---|---|---|---|
| 1 | 真实帧夹具 + `turn/end` 全原因处理 + 准入归因（§1） | 无 | 半天 |
| 2 | 归档 watcher + 发送探针 + `OFFICIAL_AGENT_BLOCKED/ARCHIVED`（§1、§3.1） | 步 1 | 半天 |
| 3 | 工具/思考映射 + 去重 + 截断（§2） | 步 1（终态正确） | 一天 |
| 4 | 归档双向 + chat 通道 + 面板徽标（§3.2–3.4） | 步 2 | 一天 |
| 5 | 预设注册排障（§4） | 无（可并行） | 半天 |
| 6 | 真机验证：一条归档消息、一条工具调用消息、一次归档/恢复往返 | 全部 | 半天 |

每步结束都跑 `node --test tests/*.test.mjs`（当前 97 / 96 pass / 1 skip），并更新 `AGENTS.md` §9 的未完成清单。

---

## 6 明确不做

- 不做预览 / 渲染 / 导出（没沙箱、没授权模型）；
- 不新建"归档列表"界面：一律用 DSH 的归档集合，避免两套真相；
- 不删除任何会话、项目、素材；
- 不把 `openfilm_draft` 变成保存；
- 不在没有真实帧证据的情况下猜 chunk 名或事件名。

---

## 7 需要你拍板（3 个）

**A. 归档项目再发消息时，默认怎么办？**
  - A1（我建议）：明确拒绝 + 面板给"恢复"/"新建会话"两个按钮，用户选；
  - A2：自动恢复归档（发消息即取消归档）；
  - A3：自动新建会话并换绑（旧的保持归档）。

**B. 视频面板里的归档，要不要和 DSH 双向？**
  - B1（我建议）：双向，调同一个 `archiveSession`；
  - B2：只单向（DSH → 面板），面板不提供归档按钮。

**C. 工具卡片的信息量？**
  - C1（我建议）：名称 + 参数摘要（前 200 字）+ 状态 + 完成后的结果首 500 字；
  - C2：只显示名称 + 状态（最省事，但"在干什么"信息不足）。

---

## 8 测试夹具来源（避免再自编事件）

- 准入帧：`%TEMP%\dsh-openfilm-frames.jsonl` 现有的 4 行（inbox/spliced → turn/start → turn/end blocked）；
- 工具帧：本会话日志解压后的 `tool/call` / `tool/result` / `assistant/message` 原始 JSON（去掉私有路径后入夹具）；
- 归档帧：`workspaceController.follow` 的 `baseline` / `archived` 形状，按契约构造（服务已声明）。

一句话：**先把"真实事件长什么样"钉进测试，再改逻辑**——这条不改，下次还会在同一个地方翻车。
