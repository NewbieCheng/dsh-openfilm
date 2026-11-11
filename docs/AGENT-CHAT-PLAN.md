# 智能体对话接入：现状、差距与计划

> 面向开发者的自查文档。结论先行：**协议层基本接通，缺的是「显示」和「选择」两处的对齐，以及附件策略的收口。**
> 版本基线：DSH 插件 0.6.x / 官方 OpenFilm 0.3.1（`vendor/official-shell`）。

---

## 1. 你问的四件事，逐条结论

| 问题 | 结论 | 证据 |
|---|---|---|
| OpenFilm 怎么接智能体？ | 它把宿主当 **ACP 客户端**：界面只认 `agents` 名单 + `localAgents.prompt` 两个入口，模型走 ACP 的 `session/new`、`session/prompt` | `src/official-facade.mjs:100-107`（名单）、`src/official-facade.mjs:230-273`（prompt） |
| 能不能把 DSH 的工具调用、思考流都显示过来？ | **协议已经转过去了**：`tool/call`→`tool_call`、`tool/result`→`tool_call_update`、思考→`agent_thought_chunk`。但**真机里还没确认工具卡片出现**，这是当前最大的一处「未知」 | `src/official-agent-events.mjs:142-165`（工具）、`:172-180`（思考/正文） |
| 左侧聊天框选 AI、引文件 | 选 AI = 官方界面的 agent 选择器，读我们要 `agents.list` 的名单（目前只有一个 `DeepSeek Harness`）；引文件 = 输入框把 `@路径` 当**纯文本**塞进 prompt，**不会上传字节** | `src/official-facade.mjs:101`、`:230-273` |
| 视频会不会被传过去？ | 走 `@assets/xxx.mp4` 这种路径引用时**不会**；只有被当作「附件」拖进输入框、走 `saveAttachment` 的字节才会 `PUT` 到 `assets/upload/`，上限 256 MiB，且只限当前项目 | `src/official-facade.mjs:328-333`、`src/studio-proxy.mjs:554-590` |

---

## 2. 现在的数据流

```
官方 shell（注入宿主 API）
   │  openfilmHost = { agents, localAgents, chat, files, layout, ... }
   ▼
src/official-facade.mjs          浏览器侧垫片：把宿主 API 翻译成 /__dsh/official-rpc
   │  POST /__dsh/official-rpc  { channel, payload }
   ▼
src/studio-proxy.mjs             同源鉴权 → 交给 Host 的 officialRpc
   ▼
src/official-chat-rpc.mjs        固定通道白名单（chat:load / save-turn / agent:models / agent:prompt …）
   ▼
src/official-agent-service.mjs   DSH 会话 ↔ ACP 事件
   │  ACP 事件（session/update 流）
   ▼
src/official-agent-events.mjs    去重、排序、转成 shell 认的 sessionUpdate 形状
   ▼
src/official-event-stream.mjs    SSE 回页面
```

关键点：**Shell 从不直连模型**。它只发 ACP 形状的请求，所以我们能把 DSH 的工具、思考、审批全部伪装成 ACP 事件送回去——这是这条路线的最大好处，也是唯一正确的接入点。

---

## 3. 已接通 / 半接通 / 未接通

### 已接通（有代码 + 有测试）

- 会话创建与首条消息（含默认模型采纳）
- 文本流、思考流（`agent_thought_chunk`）
- 工具调用**事件**（`tool_call` / `tool_call_update`，含 failed/completed 状态与输出）
- 审批（`official-approvals.mjs`）
- 会话存档：`chat:load` / `save-sessions` / `save-turn` / `archive`
- 附件上传通道（`saveAttachment` → `assets/upload/<name>`，带项目鉴权、大小与文件名校验）

### 半接通

- **工具卡片显示**：事件造好了，但没在真机确认过渲染（`AGENTS.md` §9 第 3 条）。风险在两处：`title`/`kind` 字段是否够（我们现在只给了工具名，状态里 fallback 是 `title:'tool'`，见 `official-agent-events.mjs:153`），以及 shell 是否要求 `locations`/`content` 的特定形状。
- **智能体选择器**：名单只有一条 `DeepSeek Harness`，字段是 `id/name/shown/status/configurationRevision`；官方上游的条目还带版本、图标、用量，缺字段时界面可能不显示头像或灰掉。
- **模型目录**：`agent:models` 通道在（`official-chat-rpc.mjs:54`），但目录内容依赖 `official-model-catalog.mjs`，与 DSH 实际可用模型是否一致未在真机核对。

### 未接通

- 附件策略：目前**任何类型**的字节都能进 `assets/upload/`（只限 256 MiB），没有「视频只传路径」的拦截。
- 上游 `agents.connect / signIn / switchAccount / usage` 等真实能力：现在是 `methods()` 直接 reject，界面若点了会报「不可用」。
- 多智能体：DSH 侧如果要暴露多个（不同预设），roster 还没做动态映射。

---

## 4. 计划

### P0 · 先证明，不猜（0.5 天）

在真实 GUI 里发一条会触发工具的指令，记录三件事：

1. 思考流是否出现、是否与正文分开；
2. 工具卡片是否出现、标题是什么、展开有无输出；
3. `%TEMP%\dsh-openfilm-frames.jsonl` 里对应帧的 `type` 与我们的映射是否一致。

验收：三张截图 + 一段 frames 摘录。**这一步不做完，后面全是猜。**

### P1 · 工具与思考的显示对齐（1–2 天）

- 按 P0 的真实帧修正 `toolCallEvent` 的字段：补 `title`（人类可读，如「读取文件」）、`kind`（read/edit/search/execute）、`locations`；
- 补一条夹具测试：用 P0 抓到的真实帧喂 `applyFrame`，断言输出事件形状；
- 处理「同一 callId 的 call/update 乱序」——现在依赖 `state.tools[callId]?.done`，需要补乱序用例。

验收：真机里工具卡片出现，标题可读，失败时显示红色状态。

### P2 · 智能体与模型选择（1–2 天）

- 补齐 roster 字段（版本、描述、头像/图标、`capabilities`），至少让选择器显示成「DSH · DeepSeek Harness」而不是一条裸记录；
- 模型目录改为从 DSH 的模型注册表读取，`agent:models` 返回 `{ models:[{id,name,provider}], selected }`；
- 选中后把模型写进 Host 会话（现有的「建会话后一次性采纳默认模型」逻辑要扩展成可切换）。

验收：选择器里能看到模型列表，切换后发出的第一条消息确实用该模型（看 `frames.jsonl` 的模型字段）。

### P3 · 附件策略收口（1 天）

- 上传白名单：只允许图片（png/jpg/webp/gif），单文件 ≤ 8 MiB；
- 视频/音频/工程文件一律**拒绝上传**，提示「请用 @ 路径引用，不会复制文件」；
- 校验 `@` 引用：输入 `@assets/xxx.mp4` 时 prompt 文本原样带上路径，不触发任何 upload（加一条测试钉住）；
- 如果上游对拖拽文件会无条件调 `saveAttachment`，就在垫片层按 MIME 拦截并返回明确错误。

验收：拖一个视频进输入框 → 不产生 `assets/upload/` 文件，界面给出提示；拖一张图片 → 正常上传并被模型看到。

### P4 · 打磨（时间待定）

- 审批卡片的真实渲染；
- 会话恢复后历史工具卡片的重建（`chat:save-turn` 存的是 items，需要确认工具条目也被存）；
- 错误态：模型不可用、上下文超限、工具被拒，各自给一句人话。

---

## 5. 需要你决策的三点

1. **要不要多智能体？** 只接 DSH 一个（现状）最稳；如果要暴露多个（不同预设/不同模型），roster 与 `localAgents` 的 key 映射要重新设计，工作量约 +1 天。
2. **附件上限取多少？** 我建议图片 8 MiB；视频一律路径引用。你如果有更大的参考图需求，告诉我数字。
3. **工具卡片要做到多细？** 只显示「名称 + 状态」是 P1 的最小值；要做到展开看 diff/命令输出，需要额外解析工具入参，约 +1 天。

---

## 6. 明确不做

- 不接真正的 Codex / Claude 二进制（上游支持，但我们只桥 DSH）；
- 不实现导出、渲染、预览（与对话无关，且需要另一套授权模型）；
- 不为了显示效果伪造工具结果——所有卡片必须来自真实 ACP 事件。
