# 0.7.0 设计文档：让"一句话出片"真的成立

> 这份是**设计**（为什么这样搭、各层契约是什么、失败怎么退化）；排期与验收在 `PLAN-0.7.0-AGENT.md`，最后由你一次性跑的在 `TEST-CHECKLIST.md`。
> 版本：0.7.0 设计基线（对应插件 0.6.1 → 0.7.0）。上游 pin：`openfilm@0.3.2`（内核）；界面快照 `vendor/official-shell` 仍为 0.3.1。

---

## 1. 目标与非目标

**目标（验收口径只有这一条）**：用户在右侧对话里写一句话，agent 能自己看清项目、改对时间轴、导出可播放的视频；全程用户不需要打开 film.html，也不需要理解 DSH 的内部。

支撑它的四个必要条件，缺一即不成立：

| # | 条件 | 现状 |
|---|---|---|
| C1 | agent 有**足够权限**（读写项目、跑命令、起子进程） | ✗ 默认工作区 + 每步询问 |
| C2 | 用户**看得见**它在干什么、卡在等什么 | ✗ 全部塌成「正在处理」 |
| C3 | agent **看得见自己改的画面** | ✗ 无渲染能力，只能猜 |
| C4 | agent 能**改对时间轴**（不是只读） | ✗ 只有内存草稿，不落盘 |

**非目标**：多智能体编排；替用户配服务商 key；把 Studio 的 key 暴露给渲染进程；做一个新的编辑器 UI。

---

## 2. 系统现状（谁在跟谁说话）

```
┌──────────────────────── DSH Host（Node 进程，唯一可信边界）────────────────────────┐
│  sessionController ── DSH 会话（真模型、真工具、真沙箱、真审批）                    │
│        ▲                                                                            │
│        │ prompt / cancel / selectModel / approval/request（瀑布）                    │
│  official-agent-service ── 帧翻译 ── official-agent-events（tool/assistant→ACP 形状）│
│        │ emit(projectId, event)                                                     │
│  official-event-hub ──SSE──▶ 官方壳子（vendor/official-shell，React，自己的 act 词典）│
│        │                                                                            │
│  studio-controller ── HTTP ──▶ Studio（上游内核 0.3.2，界面快照 0.3.1；自带 Chromium 渲染 + ffmpeg 导出）│
│        │  key 只在 Host                                                            │
└────────┼───────────────────────────────────────────────────────────────────────────┘
         │ /__dsh/official-rpc（白名单 channel）、/__dsh/official-events（SSE）
   ┌─────▼─────────────────────┐
   │ 官方页面（Studio UI + 我们的 chat）│  ← 用户唯一入口
   └───────────────────────────┘
```

三条**已存在但没接好**的通道：① DSH 帧 → ACP 事件（形状对，语义丢）；② 审批（DSH 有，我们没接）；③ Studio 能力（HTTP 都在，agent 没有工具去调）。

---

## 3. 目标架构（在现有骨架上补四层）

```
L0 权限层    permissionPresets.set(session,'danger-full-access')     ← 第 2 步
L1 观测层    frames.jsonl + bridge-trace + /diagnose.bridge          ← 第 1 步
L2 呈现层    act 词典 / plan / notice / 失败态                        ← 第 4 步
L3 控制层    审批桥 + aborted 归一 + 并发插话不冲突                    ← 第 5 步
L4 能力层    openfilm_frame|film|library|get|clip|export|cli          ← 第 6–8 步
L5 入口层    模板/空白草稿 → 预绑会话 → 首句建议 → 导出               ← 第 8 步
```

层间只允许单向依赖（L5→L4→L3→L2→L1→L0），任何一层不得反向调用；`client.js` 是构建产物，永不手改（`AGENTS.md` §4.3）。

---

## 4. 关键契约

### 4.1 事件契约（Host → 页面）

官方壳子的入口是 `onEvent({key, kind:'update'|'done', update})`，**key 必须是一轮的 `local:` turnId**，否则事件落在错误的 turn 里或被丢弃。`update.sessionUpdate` 的取值与壳子行为：

| sessionUpdate | 壳子行为 | 我们的责任 |
|---|---|---|
| `agent_message_chunk` | 追加到气泡正文 | 流式片段按 index 去重 |
| `agent_thought_chunk` | 追加到"思考"折叠区 | 只读 `content.text` |
| `tool_call` | 新卡片：`title` + 由 `kind` 决定的中文动作 + `rawInput` 的细节 | **`kind` 必须是 `read/edit/search/execute/fetch/think/other` 之一；`rawInput` 必须是对象** |
| `tool_call_update` | 只有 `completed`/`failed` 改状态，中间态不画 | 用"新 tool_call + plan + notice"表达进度，别指望 update |
| `plan` | 计划清单（`entries[]`） | 由 `todo_write` 映射 |
| `notice` | 一行系统提示（`title`/`description`） | 里程碑、插话、等待审批 |
| `permission` | 权限卡（`requestId` + `params.toolCall.title` + `options[]`） | 由 `approval/request` 桥接 |

> 这是 L2 的全部依据，也是"右边只有一句正在处理"的根因所在（现在我们恒发 `kind:'other'` + 字符串 `rawInput`）。

**实现（第 4 步已落地）**：`src/tool-call-act.mjs` 是唯一把工具名翻成上表的地方。

| 输入 | 输出 |
|---|---|
| `read` / `ops_read_files` / `read_image` | `kind:'read'` + `rawInput.path` + `locations[].path` |
| `write` / `edit` / `apply_patch` / `str_replace_editor` | `kind:'edit'`（同上） |
| `glob` / `grep`（pattern 可能是数组） | `kind:'search'` + `rawInput.pattern` |
| `pwsh` / `bash` / `terminal` | `kind:'execute'` + `rawInput.command`（字符串或 argv） |
| `web_search` / `web_fetch` | `kind:'fetch'` + `query` / `url` |
| `todo_write` | 不是卡片，而是 `plan` 更新（`entries[{content,status}]`），其 result 不再画卡 |
| `openfilm_frame` | `title:'openfilm:look'` + `{at}` —— 借用壳子自己的「看一帧」词条 |
| `openfilm_film` / `openfilm_export` / `openfilm_clip` | `openfilm:check` / `execute`+`openfilm render` / `edit`+`locations` |
| 其它 | `kind:'other'` + 浅拷贝入参（键名白名单、字符串≤300、深度≤2） |

参数解析兼容两种记录形态（JSON 字符串 / 对象）；解析失败得到 `{}` 而不是字符串——**`rawInput` 永远是对象**，这是壳子能否取到细节的前提。

### 4.2 工具契约（Host → Studio）

所有项目级工具只接受 **`projectId`（Host 侧校验过的）+ 相对路径**，绝不接受渲染进程给的绝对路径；Studio key 永不离开 Host。

**实现（第 6 步已落地）**：`src/studio-http.mjs` 是唯一出口（key、超时 30s、`redirect:'error'`、失败转成人话、**错误信息里的 key 会被打码**）。

| 工具 | 上游调用 | 关键约束 |
|---|---|---|
| `openfilm_frame` | `GET /api/projects/:id/media?path=film.html&what=frame&ms=&w=` / `what=poster` / `what=probe` | 页面帧由 Studio 的 Chromium 画（上游 `pageFrame`），**不需要本机 Chrome/CLI**；图片经 `attachments.saveImage` → `{type:'image', attachment}`；模型不支持读图时**明说看不到** |
| `openfilm_film` | `GET /api/projects/:id`、`…/exports` | 返回 Studio 解析后的轨/片段/锁定与外编能力（`can`）；`filmMissing` 会明说 |
| `openfilm_library` | `POST /api/get/library {verb,args}`（搜）+ `POST /api/get {folder,verb,args:{take}}`（取进项目） | 搜索是离线标签匹配、免费；`take` 才动项目 |
| `openfilm_get` | `GET /api/get`（有什么可做）+ `POST /api/get {folder,verb,args,yes?}` | 未连服务 → 把上游原话转给人（**不重试**）；花钱的动作只有 `yes` 才不弹确认 |
| `openfilm_clip` | 文件系统（改项目内 `film.html`） | 落盘前**两道**检查：读前读后 mtime/size 一致、rename 前再比一次 hash；基线用 **sha256 前 16 位**（mtime 分辨率不够）；写 = 同目录临时文件 + rename；锁定轨道/重叠由 `applyTimelineOperations` 拒绝；`dryRun` 只报告不写 |
| `openfilm_assets` | `GET/PUT /api/projects/:id/files` | PUT 直接送**原始字节**（不是 JSON），走 Studio 的导入管线（素材面板可见、有 poster/probe）；`into` 拒绝 `..`、盘符和绝对路径 |
| `openfilm_export` | `POST/GET /api/projects/:id/exports` | 先读 `can`；ffmpeg 缺失 → 说缺 |
| `openfilm_cli` | 子进程 | 只开 doctor/look/render，argv 自建（不经 shell），cwd=项目，`NO996_OPENFILM_CLI` 双向保护 |

### 4.3 权限契约

- 单位是**会话**，不是整个 DSH：`permissionPresets.set(session, preset)` 写三条 durable 事件（`permission/preset`/`sandbox/mode`/`approval/policy`）。
- `danger-full-access` = 全盘读写 + **永不询问**；`workspace-write` = 工作区可写 + 询问。
- 授权必须由**用户点一次按钮**触发，且按钮文案写明代价；选择按项目记在 `no996_openfilm_project_permissions`，面板可改回。
- 完全访问模式下不存在审批 → 审批桥只服务工作区模式。二者是互补，不是替代。

**实现（第 2 步已落地）**

| 位置 | 职责 |
|---|---|
| `src/official-permission.mjs` | 记录/应用/回滚：`decide`（还没有会话时先记）、`apply`（`permissionPresets.set`）、`resume`（新会话上补应用）、`forget`、`current`、`names`、`available` |
| `studio-controller`（Host） | 通道 `agent:permission`（面板问"要不要问用户"）、`agent:permission-set`（用户答）；`agent:prompt` 发送前 `resume`，让"先答后发"也成立；`/diagnose.permission` |
| `assets/shell-ui.js`（页面） | `/projects/<id>` 上一次性确认卡 + 常驻胶囊；点了才调 `permission-set`；`client:log` 记 `permission-shown`/`permission-chosen` |

会话对象的解析：`permissionPresets.set` 要的是 **Session 对象**，Host 用 `ctx.agents.list()` 按 `session.id` 找到它（上游自己的 `pinInitialPermission` 也是这么拿的）；绑定关系来自 `peek(projectId)`，**读权限永不建会话**。

### 4.4 CLI 契约（已定：HTTP 为主，CLI 兜底）

**定案（PLAN §10 决策 2 采纳推荐）**：日常一律走 Studio 的本地 HTTP API；openfilm_cli 只放 doctor / look / render 三个动词，argv 由 Host 自建（不经 shell）、cwd 固定项目目录。反转条件见 PLAN §10 末尾。

- 路径由 Host 解析后**写进预设提示词**，模型不许猜、不许 `npx`。注意上游 `exports` 映射里**没有** `./bin/openfilm.mjs`，所以只能 `require.resolve('openfilm/package.json')` 再拼 `bin/openfilm.mjs`（`cli-tool.mjs` 的 `resolveCli` 就是这么做的）。
- 调用方式固定：`node "<resolved>" <verb> [args]`，cwd = 绑定项目目录。
- 手段优先级：`openfilm_*` 工具 → `openfilm_cli` → 手写 film.html（必须声明"看不到画面"）。
- 前置：`doctor` 自检；首次 `look`/`render` 下载 Chromium；工作区模式下子进程会被沙箱拒（明确让人切完全访问）；`NO996_OPENFILM_CLI=1` 可整体关闭（我们给子进程显式设 `0`，防递归）。
- 不接管 `~/.openfilm/run.json` 的生命周期：仅在我们自己的 Studio 存活期间代写、退出恢复；若已有指向另一个活 Studio 的记录则不覆盖。

### 4.5 思考强度契约（第 3 步）

- **档位只来自模型自己声明的 `reasoning.efforts`**（`llm.resolveModelInfo` → `buildModelCatalog`），面板不发明档位；模型没声明就没有这个菜单项。
- **`auto` 是一种意图，不是档位**：存在 `no996_openfilm_project_thinking`，与 DSH 里"会话当前的档"分开存——否则"自动"和"手动选了中"无法区分。
- **自动规则**（`chooseEffort`，纯函数）：手动选择优先 > 整片/重排/重构 → 最高档 > 起稿/草稿/大纲 → 最低档 > 首轮 → 最低档 > 提供方默认 > 中间档。
- **应用方式**：`controller.selectModel({sessionId, provider, model, reasoningEffort})`，在 `send()` 里、prompt 之前；失败只降级不阻断（偏好不是前置条件）。
- **读当前值**：`controller.list()` 的 `projections.modelSelection`（`next` 优先，`lastUsed` 兜底），因此 DSH 侧改的模型/档位在这里立刻可见。

### 4.6 审批与打断契约（第 5 步）

| 环节 | 行为 |
|---|---|
| 事件来源 | DSH 的瀑布事件 `approval/request`（`{agent, toolName, callId, reason, signal}`），answerer 用 `ctx.on` 注册 |
| 只接管自己的一轮 | `projectOfSession(会话 id)` 命中绑定表 **且** `agentService.activeKey(projectId)` 有值——否则原样 `next()`，不干扰别的会话 |
| 面板呈现 | 发 `permission` 事件（`requestId` + `toolCall.title` + `allow-once`/`reject-once`）**加**一条 `notice`，保证即使卡片 UI 不画也看得见 |
| 竞速 | 面板答案与 `next()` 一起 `Promise.race`；`next()` 只调用一次；面板无活流（`deliver` 返回 false）就直接交给下游 |
| 回答路径 | 页面 `answerPermission(key, requestId, optionId)` → `agent:answer-permission` → 校验 key 仍是当前轮 → `approvals.answerRequest` |
| 一次性 | pending 表项被删除后，第二次回答返回 `ok:false`；另一侧 UI 仍显示卡片属正常（我们无法改 DSH 自己的界面） |
| 打断 | `turn/end{reason.kind:'aborted'}` **一律**归一为 `{ok:true, stopReason:'cancelled'}`（谁点的停止都一样） |
| 并发插话 | 别人在 DSH 里插一句话：发一次 `notice`（"排在本轮之后"）并继续跟随，**不再**抛 `OFFICIAL_AGENT_CONFLICT` |

### 4.7 失败语义（不许"看起来成功"）

| 场景 | 正确表现 |
|---|---|
| 模型不支持读图 | 明说"画面已渲染但你看不到" |
| 无 ffmpeg | 明说缺什么、在哪装 |
| 时间轴被外部改过 | 拒绝写入并给出冲突文件与 mtime |
| 轨道锁定 | 拒绝并指出哪条轨 |
| 未连服务商 | 让人去 Studio 连，不排队等 |
| 面板没接收事件 | `/diagnose.bridge.refused` 计数 + 页面 `client:log` |
| 审批在另一侧已答 | 后答方得到"已失效"，不重复执行 |

---

## 5. 三条链路（端到端）

**A. 空白草稿 → 一句话出片**
`面板首页 → 建项目(模板/空白) → 建会话 → 首次授权 → 首句建议 → agent: film读→frame看→clip写→export导 → 面板显示可播放路径`

**B. 自带素材 → 定点替换**
`拖入 mp4 → Host 落 assets/upload/ → 回"可引用路径" → 用户说"放到标题图位置" → agent: film读→frame看(前后各一帧)→clip place→frame复核`

**C. 任何时刻的可解释性**
`tool_call(act, detail) 逐条 → todo_write→plan 打勾 → notice 里程碑 → 审批/中止显式化`

---

## 6. 测试策略

| 层 | 方式 | 边界 |
|---|---|---|
| 纯函数（act 映射、权限记录、URL 拼装、CLI 路径、trace） | `node --test`，无 IO | **不许调真模型** |
| 服务/控制器（审批竞速、并发插话、事件枢纽） | 注入桩：假 hub、假 studio fetch、假 ctx.on | 不碰用户项目 |
| Studio 集成（frame/library/export） | 假 HTTP（录制的形状），真解析 | 不启真 Chromium |
| 端到端 | **用户按 `TEST-CHECKLIST.md` 一次性跑** | 我在交付前自查前置条件 |

---

## 7. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 写 `run.json` 与用户自己的 OpenFilm 冲突 | CLI 打错 Studio | 只在无活 Studio 时写；退出恢复；开关可关 |
| `danger-full-access` 被滥用 | 全盘可写 | 仅会话级、用户点击、面板可改回、工具仍只认项目内相对路径 |
| 壳子 act 词典随版本变化 | 我们又退回「正在处理」 | 词典做成本地映射表 + 单测；`/diagnose.bridge.kinds` 可验证 |
| 审批两侧同时答 | 重复执行 | 一次性 pending + 后到者返回"已失效" |
| 首次 Chromium 下载 | 长任务像卡死 | 先发 `notice`，再起子进程 |
| 事件流背压丢帧 | 显示不全 | `bridge.accepted/refused` + 页面 `seen` 差值监控 |
| agent 写到旧的 film.html | 覆盖人的手动改动 | hash 基线 + 写前二次比对 + 原子 rename（`clip-tool`） |
| CLI 被子进程递归调用 | 无限套娃 | 白名单动词 + `argv` 自建（不经 shell）+ `NO996_OPENFILM_CLI` 双向保护 |

---

## 8. 与八步计划的映射

| 步 | 设计层 | 主要模块 |
|---|---|---|
| 1 | L1 观测 | `bridge-trace.mjs`、`studio-controller`（diagnose/emit）、`official-facade`（页面计数上报） |
| 2 | L0 权限 | `official-permission.mjs`、面板确认卡、`project-conversation` |
| 3 | L0/L5 会话 | `project-conversation`、`official-agent-models`、`openfilm-prompt` |
| 4 | L2 呈现 | `official-agent-events`（act 词典）、`tool-call-act.mjs` |
| 5 | L3 控制 | `official-approval-bridge.mjs`、`official-approvals.mjs`、`official-agent-service` |
| 6 | L4 能力 A | `frame-tool.mjs`、`film-tool.mjs`、`library-tool.mjs`、`get-tool.mjs` |
| 7 | L4 能力 B | `clip-tool.mjs`（原子写+hash 冲突）、`assets-tool.mjs`（Studio 导入管线） |
| 8 | L5 入口 | `export-tool.mjs`（先读 can 再排队）、`cli-tool.mjs`（三动词白名单/argv 自建）、`openfilm-prompt` 首句即开工 |
