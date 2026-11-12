# 架构：OpenFilm × DSH 的正确接法（ACP 为边界）

> 状态：方案待批（2026-11-13）。批准后按 §7 的里程碑实施，并把未完成项并入 `docs/ROADMAP.md`。
> 依据：本机 OpenFilm 源码 `F:\Dev\_upstream\openfilm`（apps/desktop）与我们的 `src/official-*` 实现。

## 1. 事实：OpenFilm 的对话本来就是 ACP

| 事实 | 出处 |
|---|---|
| 官方 chat 的 agent 是"子进程 + ACP over stdio"，客户端做 `initialize → session/new（或 session/resume）→ session/prompt`，`session/update` 驱动界面，`session/request_permission` 弹权限 | `apps/desktop/src/agents.mjs` 文件头 |
| "DeepSeek Harness" 是官方内置 agent：`args: ['--profile','acp']`，无登录命令 | `apps/desktop/src/agents.mjs:100` |
| 思考、工具调用、工具结果、上下文用量、重试都是 ACP 的 session/update，**流式** | `agents.mjs` 注释、`chat/src/lib/desktop-bridge.ts` 的 `LocalAgentEvent`、`chat/src/lib/local-agent-run.ts` |
| 会话可续：`session/resume`（capabilities 支持时），否则 `session/load` | `agents.mjs:1394` |
| 附件可走**引用**：ACP `resource_link`（`file://` 路径）进 prompt，不搬运文件 | `apps/desktop/src/pi-agent.mjs:293` |
| 拖放由界面自己处理（`App.tsx` 的 `onDrop`） | `chat/src/App.tsx:1029` |

结论：**契约是 ACP，不是 RPC。** 我们现在的 `agent:*` RPC + `official-agent-service` 是把 ACP 的语义手工重写了一遍——思考流、续聊、并发、权限、附件自然全都对不齐。

## 2. 现状：哪里不通，为什么

| 现象 | 直接原因 | 根因 |
|---|---|---|
| `HTTP 503 … OFFICIAL_AGENT_BUSY (agent:select-thinking)` | 每个项目一个"回合锁"，思考/模型选择被当成回合操作，忙时直接抛错 | 手写状态机把"会话级"操作塞进"回合级"互斥 |
| 中断后不能续聊 | 我们的映射只保留"当前 turn"，没有 ACP 的 session/resume 语义；重连后拿不回上下文 | 会话身份不在单一来源 |
| 一侧有思考过程、另一侧没有 | 思考流是我们自己在 facade 里拼的事件；侧栏会话是 DSH 自己的流，两边各画各的 | 存在两份会话真相（`.film/chat/` 与 DSH session） |
| 拖 400MB 视频进对话 | 附件走"上传到项目再交给模型"，`official-facade.mjs:434` 与 `official-attachment.mjs` 硬上限 256 MiB | 把"素材入库"与"对话引用"混成一件事 |
| 每个项目左侧多一个工作区 | `project-conversation` 为落座会话 `workspace/create`，且命名没有约定 | DSH 的会话必须有工作区；我们把"工程细节"暴露成了产品噪音 |
| 切换面板后对话接不上 | 面板会话与侧栏会话各自由不同入口创建 | 同上：两份会话真相 |

## 3. 目标架构

```
┌───────────── DSH Web（侧栏 / 对话）─────────────┐
│  Session S（唯一真相，持久化在 DSH）             │
└───────────────▲──────────────────────────────┘
                │ DSH 自己的会话事件（思考/工具/审批）
┌───────────────┴──────────────┐
│ OpenFilm 面板（官方壳，iframe） │
│  chat UI ← ACP session/update │
└───────────────▲──────────────┘
                │ ACP JSON-RPC（stdio 或 loopback）
┌───────────────┴──────────────┐
│ 我们的 Host                  │
│  一个项目会话 = 一个 ACP 子进程 │
│  `dsh --profile acp`（cwd=项目）│
└──────────────────────────────┘
```

- **单一会话真相**：面板里的对话就是侧栏里那条 DSH 会话（同一个 session id）。续聊、思考、工具、审批全部由 DSH 产生，两边都只是渲染。
- **边界是 ACP**：Host 不再手工映射"回合"，只做 ACP 客户端（`initialize/session.new|resume/session.prompt/cancel`，转发 `session/update`、`request_permission`、模型与 effort 选项）。
- **引用优先**：对话里的媒体是 `resource_link`（路径 + 可选缩略图），不复制、不上传；只有"导入项目素材"这个显式动作才写盘。
- **工作区是承载，不是产品**：每个项目目录一个工作区，命名固定，复用优先，绝不重复创建。

## 4. 决策（每项已给推荐；你未否决即按推荐执行）

### D1 集成边界

- **推荐：ACP 边车**——Host 为每个项目会话启动 `dsh --profile acp`，我们只做 ACP 客户端，删掉 `official-agent-service` 的手写回合状态机。
- 备选：继续加固现有 RPC 桥（成本低，但 ACP 能力永远补齐不了：思考流、resume、steering、模型切换都会继续错位）。

### D2 会话身份

- **推荐：一个项目 = 一条 DSH 会话**，id 存进项目绑定；面板、侧栏、续聊都用它。`.film/chat/` 只保留"显示用回合记录"，不再是连续性来源。
- 备选：保留两条会话并做双向镜像（不推荐：必然再次不同步）。

### D3 工作区

- **推荐：按项目目录承载，命名 `<项目名> · 视频创作`**；目录已有用户工作区则复用，没有才建，建完写进绑定。**不做侧栏标记注入**（0.13.0 已定：侧栏零注入）；可辨识性靠名字，不靠 UI 技巧。
- 备选：全部项目塞进一个"视频创作"工作区（会话 cwd 会错，不推荐）。

### D4 附件

- **推荐：对话附件一律"引用"**（`resource_link` 指向本机路径；图片给缩略图）。删除对话路径上的 256 MiB 上传；上传只保留给"导入项目素材"按钮，且受项目目录约束。
- 备选：提高上传上限（不推荐：500MB 事件会塞满上下文与磁盘）。

### D5 并发

- **推荐：按会话串行、按项目并行**；同一会话正在跑时，新消息变成 `steer`（ACP 支持）或排队，返回"进行中"而不是 503；模型/思考选择是会话级操作，任何时候可改。
- 备选：全局串行（简单但体验差）。

### D6 上游改动方式

- **推荐：以补丁集形式改 `F:\Dev\_upstream\openfilm`**（只碰 `chat/` 与 `src/` 的少量文件），随插件发布 `vendor/official-shell` 与 `OFFICIAL_COMMIT` 三处同步；把"引用式附件 + 拖放引用 + 工作区命名"做进源码，而不是 DOM 注入。
- 备选：继续注入（已证明脆弱，不推荐）。

## 5. 改造清单

### 5.1 我们的 Host（可先做，不等上游）

1. `project-conversation`：工作区命名 `<项目名> · 视频创作`；先查同路径工作区，复用优先；日志记录 create/reuse。
2. 新增 `src/acp-client.mjs`：启动/复用 `dsh --profile acp`，管理 `initialize`、模型目录、`session/new|resume`、`prompt/cancel`、事件转发、子进程退出回收。
3. `official-facade` / `official-chat-rpc`：把 `agent:*` 从"手写回合"改为 ACP 转发；`agent:select-model`、`agent:select-thinking` 映射到会话 config 选项；删除 `OFFICIAL_AGENT_BUSY` 的 503 路径，改为 `steering` 或排队。
4. `official-attachment`：对话附件改为引用（路径白名单：项目目录内任意文件、或用户显式选择的本机文件），仅缩略图走内存；`official-facade` 删除 256 MiB 判断。
5. `official-agent-events`：以 ACP `session/update` 为唯一事件源；思考增量原样转发。

### 5.2 上游补丁（`F:\Dev\_upstream\openfilm`）

1. `apps/desktop/chat/src/App.tsx` 的 `onDrop`：接受本机文件 → 生成引用块（不读全文件）；视频/音频只读元信息与首帧缩略图。
2. `pi-agent.mjs` 的 `resource_link` 处理路径：确认非图片引用被渲染成"路径胶囊"而不是附件。
3. `agents.mjs`：暴露"引用式附件"能力标记，避免 UI 走上传分支。
4. 会话列表：显示 agent 侧 session id（便于排障），不新增产品概念。

补丁落地方式：fork 上游 → 打补丁 → 构建 `apps/desktop/chat` 与 shell → 更新 `vendor/official-shell/{manifest.json,ui,source,patch.diff}` 与 `OFFICIAL_COMMIT`。

### 5.3 删除项

- `official-agent-service.mjs` 的回合锁与手写事件拼装（保留其"项目→会话"解析与授权检查，迁到 acp-client 上层）。
- `official-attachment.mjs` 的对话上传分支（保留素材导入）。
- `official-facade.mjs` 中重复实现 ACP 语义的分支（保留协议适配与鉴权）。

## 6. 验收

1. 同一项目：面板发一句 → 侧栏同一会话出现同样内容、同样思考、同样工具卡；反向亦然。
2. 面板关闭/重开、Host 重启、断网重连后，输入框可继续，上下文不丢（`session/resume`）。
3. 一轮进行中切换模型/思考级别不再 503；同时发消息得到"已加入当前回合"，不是报错。
4. 拖入 500MB 视频：2 秒内出现路径引用卡，磁盘无副本，模型收到的是 `file://` 引用。
5. 侧栏工作区：每个项目最多一个，名字可辨识；重复打开项目不新增。
6. 权限请求出现在面板内，与 DSH 审批一致。

## 7. 里程碑

| 阶段 | 内容 | 产出 |
|---|---|---|
| M1（1–2 天） | 上游源码构建打通 + ACP 边车跑通一次 `session/new` | 面板能通过 ACP 拿到模型列表与一轮回答 |
| M2（2–3 天） | 会话身份统一、思考/工具事件转发、resume、steering | 两侧同一会话同步 |
| M3（1–2 天） | 引用式附件 + 拖放补丁 | 500MB 不再上传 |
| M4（1 天） | 工作区命名与复用、清理删除项 | 侧栏干净 |
| M5 | 真机验收（§6） | 关掉旧注入路径 |

## 8. 非目标

- 不再往侧栏注入任何东西（0.13.0 决定不变）。
- 不把 Studio 代理当安全边界。
- 不让 `openfilm_draft` 承担保存/导出。

## 9. 进展（0.13.0，边车已落地）

| 项 | 状态 | 证据 |
|---|---|---|
| ACP 线级客户端 | 完成 | `src/acp-client.mjs`；`tests/acp-client.test.mjs` 9 项；真机 `initialize/session/new/session/list` 探测通过 |
| 会话身份 | 完成 | `session/new` 的 id 存 `$DSH_HOME/no996-openfilm/acp-sessions.json`；`session/resume` 续聊（跨进程，同一子进程内 resume 会被 DSH 以"already active"拒绝，这是协议行为） |
| 模型 / 思考 | 完成 | ACP `configOptions`（model、reasoning_effort）直接映射到面板菜单；会话打开后按 Host 当前选择 `set_config_option` |
| 权限 | 完成 | 子进程按项目预设启动（`DSH_PERMISSION_MODE`）；改预设 = 丢弃子进程，下轮重建 |
| 附件 | 部分 | 不支持图片的路由 → 临时文件 + 绝对路径；支持则内联 image block |
| 工具 | 完成（待真机） | Host 的 `/api/no996-openfilm/mcp` 实现 MCP streamable-http（initialize / tools/list / tools/call / ping），`session/new` 时以 `mcpServers` 把 `openfilm_guide`、9 个影片工具与转写工具交给子进程；令牌按会话签发、随子进程退出吊销。真机探测：子进程连上端点并完成 `initialize` → `notifications/initialized` |
| 真机验收 | 待做 | 刷新页面后：面板发一句 → 侧栏同一会话；模型/思考菜单可切；权限行仍在；SenseVoice 不受影响 |

里程碑口径修正：M1/M2 已在代码层完成，M4（工作区命名）在 ACP 下不需要——会话的 cwd 就是项目目录，侧栏按目录自然分组，没有注入。工具已通过 MCP 端点补齐，剩下的就是 M5 真机验收：**刷新页面后由人发一句**，然后看 `plugin.log` 里的 `acp-session` / `acp-prompt-failed`。
