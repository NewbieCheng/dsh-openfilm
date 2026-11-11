# 开发文档 — dsh-openfilm

> 面向改动本仓的人（含智能体）。给智能体的最短约束看 `../AGENTS.md`；决策与历史看 `NOTES.md`。
> 文中的结论都对应可复查的代码位置；标"待验证"的项不要当既成事实引用。

- 版本：`0.5.8`
- 运行时：Node 20+，DSH 内核（需 `session-controller`、`storageDomain`、`webServer`、`llm`、`agents`）
- 上游：`openfilm@0.3.2`（`package.json` 里的 tarball URL 是唯一版本来源）。**内核与 `vendor/official-shell` 快照必须同版本**：`resolveOfficialShell()` 会比对 manifest 的 version/commit 与每个文件的 sha256，不匹配就抛 `OFFICIAL_SHELL_UNAVAILABLE`（表现为面板 503、项目会话建不起来、九个项目工具从会话里消失）。同版本升级时两者一起动：升级流程见 `docs/PLAN-0.7.0-AGENT.md` §14。

---

## 1. 它是什么

一个 DSH 插件，把官方 OpenFilm 视频工作台整页搬进 DSH 侧边栏的「视频创作」面板，并让官方界面里的对话使用 **DSH 的模型和会话**：

```
┌────────────────────────────── DSH Web 页面（127.0.0.1:<port>） ─────────────────────────────┐
│  侧边栏「视频创作」                                                                          │
│  ├─ main            → 占位（只上报选中状态，见 panel-keepalive）                             │
│  └─ shell.overlay   → 真面板（固定定位，跟随占位矩形），内含 iframe                          │
│                        iframe → http://<web host>:47822/  （代理后的官方 Studio / 官方 shell）│
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                   │ 同源 fetch / SSE / WebSocket
┌──────────────────────────── DSH Host 进程（Cordis Loader） ───────────────────────────────────┐
│  index.js → apply(ctx)                                                                        │
│  ├─ ctx.tools.register(openfilm_draft)          纯内存草稿工具                                 │
│  └─ createStudioController(ctx, startStudioProxy)                                             │
│       ├─ Studio 运行时（懒启动）：openfilm/studio.startStudio({port:0}) → 上游临时端口        │
│       ├─ 代理（每个浏览器 Origin 一个）：监听 47822，校验 cookie/Host/Origin，转发 HTTP+WS    │
│       ├─ 路由：/api/no996-openfilm/{bootstrap,diagnose,templates,debug-url}、/no996-openfilm/* │
│       ├─ 官方对话桥：officialRpc → DSH Session；事件 → SSE                                     │
│       └─ 模板控制台：127.0.0.1:47821（可关）                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

要点：

- **Studio 上游只 bind 临时端口，且 key 不出 Host 进程**；浏览器只能看到代理端口 47822。
- **界面快照带两处本地改动**：`agent-menu-rows.ts` 让 composer 菜单多画一行 `permission`（权限预设）；`components/ModelPopover.tsx` 把"右侧弹出面板"改成"点进去一层、箭头返回、选项列表限高可滚动、模型可搜索"（外加 5 个语言包里的两条搜索文案）。打包脚本只允许这一处 tracked 改动，diff 存为 `vendor/official-shell/patch.diff`，`manifest.json` 记 `patch.files`；升级内核/界面后要按 `patch.diff` 重新打一次，否则那一行会消失（脚本会因为对不上而拒绝打包，不会静默丢掉）。
- **官方界面默认用上游桌面 shell**（`vendor/official-shell/ui`）。设 `NO996_OPENFILM_DSH_CHAT=1` 退回"官方 Studio + 内嵌 DSH 对话列"。
- 面板挂在 `shell.overlay` 而不是 `main`，是为了**切页不重载 iframe**（`main` 只放一个上报选中状态的占位 div）。

---

## 2. 启动时序

1. Host 启动，Loader 应用 `cordis.patch.yml`：插入 `dsh-openfilm` 插件行和 `openfilm-video-editing` 预设行。
2. `index.js` 的 `apply` 注册工具与控制器。控制器立刻做三件**非懒**的事：
   - 校验 DSH Web 源是 `http://127.0.0.1:<port>`，否则抛错（拒绝远程权威）；
   - 写一次预设激活报告 `%TEMP%\dsh-openfilm-preset.json`（有界重试，因为预设行比插件晚挂载）；
   - 启模板控制台（`NO996_OPENFILM_DEBUG_PORT`，默认 47821，设 `0` 关）；
   - 订阅 DSH 归档集合（`workspaceController.follow`），服务缺席则标记 `available:false`。
3. 用户点开面板 → 面板 `POST /api/no996-openfilm/bootstrap` → 控制器首次装配：
   - `createStudioRuntime` 懒加载 `openfilm/studio`，校验版本，`startStudio({port:0, advertise:false, stays:true, askAgent})`；
   - `attach` 回调拿到上游 `{origin, key}`，写进 `upstream`；
   - 为该浏览器 Origin 建代理（`proxies` Map），代理 bind 47822，返回 `{editorOrigin, mode, webOrigin, ticket?}`。
4. 面板校验返回的地址（协议 `http:`、host 必须与页面同源、无 user/pass/path/query/hash），设 iframe `src`。
5. 主页面收到 iframe 的 `postMessage`：`{type:'no996-openfilm:boot', version:1}` → 认为官方界面已渲染；`{type:'no996-openfilm:project'}` → 记住 `localStorage['no996.openfilm.lastProject']`。
6. 20 秒内没收到 `boot` → 面板显示诊断块并让用户把文字贴回来（`/diagnose` 的返回）。

**生命周期收尾**：控制器 `dispose` 时关代理、清票据、断开 SSE/WS、`runtime` 停 Studio；`attach` 返回的清理函数负责把 `upstream` 置空并关掉所有代理。

---

## 3. 请求路径

| 场景 | 路径 | 校验点 |
|---|---|---|
| 打开面板 | 面板 → `POST /api/no996-openfilm/bootstrap`（带 `x-no996-surface`） | DSH 浏览器 peer + 同源 surface |
| 健康检查 | `POST /api/no996-openfilm/diagnose` | 只回 `mode / studio / preset / proxy`，无路径无密钥 |
| 模板列表 | 面板 → `templateRequest({action:'list'})` → 官方 RPC `template:list` 或 `/api/no996-openfilm/templates` | 浏览器会话、本机 Host/Origin、JSON、≤1 KiB、模板白名单 |
| 建模板项目 | `template:create` → `installTemplate` → 代理 `POST /api/projects` | 独占创建目录、拒符号链接、失败不删（可能已注册） |
| 对话发送 | 官方 shell → `POST /__dsh/official-rpc {channel:'agent:prompt'}` → `agentService.send` | 项目 ID 必须存在于 Studio 实时项目列表 |
| 对话取消 | 同上 `channel:'agent:cancel'` | 同上 |
| 流式回复 | `GET /__dsh/official-events?projectId=…`（SSE，来自 `eventHub`） | 项目作用域 + 每连接一次 Hub 订阅；慢客户端直接断开，不排无界队列 |
| 文件上传 | `PUT /__dsh/official-upload?projectId&name` → Studio 自己的 `assets/upload` | 不直接用 Node 写项目文件 |
| 桌面端打开 | `GET /__dsh/open#<ticket>` → `POST /__dsh/session {ticket}` → `GET /` | 票据一次性、60 秒有效、绑定 `127.0.0.2` |
| 归档状态 | 面板 → `POST /api/no996-openfilm/archive {action:'state', projectId}` | 浏览器 peer + 本机 Host/Origin + 1 KiB + 只认项目 ID |
| 归档/恢复 | 同路由 `archive`/`unarchive`/`rebind` | Host 解析绑定会话后调 `workspaceController`，页面拿不到 Session ID |
| 工作区归属 | 项目打开时 `workspaceController.create({path})`，会话用 `workspaceId` 建（或 `attachSession`） | 一个项目 = 一个 Workspace = 一条会话；没有工作区的会话会落在 DSH 侧边栏「无工作区/未分组」里 |
| 对话历史 | 官方 shell → `chat:load` / `chat:save-*` / `chat:archive*` | 归档项目：历史返回空 + `archived:true`，写入回 `OFFICIAL_CHAT_ARCHIVED` |

**失败语义**：503 只带固定错误码（`DSH_ORIGIN_REJECTED` / `DSH_SESSION_REQUIRED` / `DSH_BROWSER_REQUIRED` / `STUDIO_DISPOSED` / `OUTCOME_UNKNOWN` 等），不回原始错误、凭据或私有路径。

---

## 4. 模块职责

### Host 编排

| 文件 | 职责 | 改动风险 |
|---|---|---|
| `index.js` | `inject` 声明与 `apply` | 加依赖会改变加载时序 |
| `src/studio-controller.mjs` | 控制器：路由、生命周期、代理工厂、`officialRpc`、系统提示上下文、模板桥接线 | 高：所有信任判断汇集于此 |
| `src/studio-runtime.mjs` | 懒加载并校验上游版本，`startStudio` | 中：版本 pin 与上游契约耦合 |
| `src/studio-proxy.mjs` | 回环反向代理：cookie 校验、Host/Origin 校验、WS 帧改写、`/__dsh/*` 桥、桌面票据 | 很高：任何放松都是安全回归 |
| `src/studio-proxy-auth.mjs` | 代理侧的认证辅助 | 高 |
| `src/official-shell.mjs` | 校验 `vendor/official-shell/manifest.json`（版本、commit、逐文件 sha256） | 高：改 ui 必须重生成 manifest |
| `src/official-templates.mjs` | `listTemplates`（每次读盘）、`installTemplate`（独占创建、拒链接、限额） | 中 |
| `src/template-bridge.mjs` | `/api/no996-openfilm/templates`：鉴权 + 白名单 + 1 KiB | 高：这是浏览器可触达的写路径 |
| `src/preset-report.mjs` | 启动时把预设激活结果写 `%TEMP%\dsh-openfilm-preset.json`（有界重试，预设行比插件晚挂载） | 低 |
| `src/workspace-archive.mjs` | DSH 归档集合的唯一 Host 视图：`follow` 订阅 + `archive/unarchive`；服务缺席时 `available:false` | 高：归档即 pre-step 门禁的数据源 |
| `src/archive-bridge.mjs` | `/api/no996-openfilm/archive`：鉴权、JSON、1 KiB、只认项目 ID | 高：浏览器可触达的状态写路径 |
| `src/openfilm-prompt.mjs` | 预设 scoped prompt（只在该预设作用域生效） | 低 |

### 官方对话桥

| 文件 | 职责 | 现状 |
|---|---|---|
| `src/official-agent-service.mjs` | 建会话、`follow` 流、prompt/取消、终态、错误分类、帧记录 | 可用；会话编排单一来源 |
| `src/official-agent-events.mjs` | 流帧 → 官方 ACP 事件 | **当前主要缺口**：思考/工具未对齐 |
| `src/official-chat-rpc.mjs` | 聊天 RPC（历史加载/保存、模型列与选择） | 可用 |
| `src/official-chat-store.mjs` | 项目会话历史存储（独立 storageDomain + revision 守卫） | 可用；不读也不删上游 `.film/chat` |
| `src/official-event-hub.mjs` / `official-event-stream.mjs` | 按项目 fan-out + SSE 写出 | 可用 |
| `src/official-approvals.mjs` | 审批通道 | 未接完：审批走 DSH 自己的界面，插件无 pending 订阅，不会静默放行 |
| `src/official-facade.mjs` | 浏览器侧桥（注入官方 shell）：`localAgents.*`、SSE、上传、`chat.load/save` | 可用 |
| `src/official-model-catalog.mjs` | 模型目录（来自 Host） | 可用 |
| `src/official-project-scope.mjs` | 预留的签名式逐帧作用域 | 未启用 |

### 草稿与解析

| 文件 | 职责 |
|---|---|
| `src/film-source.mjs` | 从字节解码 `film.html`（上限 2 MiB，标 `eof`） |
| `src/film-summary.mjs` | 摘要：舞台尺寸、时长、轨道与片段 |
| `src/timeline-layout.mjs` | 时间线布局（限轨道数/片段数，未知时长不伪造比例） |
| `src/film-draft.mjs` / `src/film-operations.mjs` | 内存内 move / trim / split，锁定轨道与联动片段拒绝 |
| `src/draft-session.mjs` | 草稿的撤销/重置（保留原文与版本） |
| `src/draft-tool.mjs` | Agent 工具 `openfilm_draft`（纯操作，不保存、不执行） |
| `src/guide-tool.mjs` | Agent 工具 `openfilm_guide`（只对项目会话可见） |
| `vendor/film-doc.mjs` | 上游 `film-doc.mjs` 的未修改副本（0.3.2，MIT） |

### 客户端

| 文件 | 职责 |
|---|---|
| `src/studio-entry.js` | `window.__ModuleLoader__.load({id:'dsh-openfilm'})`；注册 `main` / `sidebar.panellist` / `shell.overlay` |
| `src/studio-panel.mjs` | 面板 UI：加载态、错误态、静默诊断块、模板首页、iframe、预设状态行 |
| `src/panel-keepalive.mjs` | 占位矩形 → 面板位置同步；激活订阅 |
| `src/client-entry.js` | 早期工作区浏览 UI，**不在构建链里** |

---

## 5. 数据与存储

| 数据 | 位置 | 归属 |
|---|---|---|
| 归档集合 | Workspace registry（`workspace.json` 的 `archivedSessionIds`） | DSH；插件只订阅与调用，不另存 |

**归档语义（0.4.0）**

- 归档是 Workspace registry 的事实，不是 Session header 字段：`sessionController.list()` 看不到，只有 `workspaceController.follow()` 的 `baseline/archived` 帧和 `archiveSession/unarchiveSession` 的返回值。
- 归档集合同时是 `agent/pre-step` 门禁读的数据：**归档会话的每个新回合都会以 `turn/end{reason:{kind:'blocked'}}` 立刻结束**。所以发送前必须探针，否则会把 gated 回合误判成协议冲突。
- 双向：DSH 侧边栏与视频面板改的是同一个集合；归档不删除任何会话/项目/素材，恢复后历史原样。
- 项目绑定保留归档会话（不静默换绑）；`rebind` 是唯一换会话的路径，旧会话保持归档。


| 数据 | 位置 | 归属 |
|---|---|---|
| 项目会话映射 | DSH storageDomain `no996_openfilm_project_conversations` | 插件；只是提示，丢了就新建会话 |
| 项目聊天历史 | DSH storageDomain `no996_openfilm_official_chat` | 插件；带 revision 守卫 |
| 旧两阶段注册表 | `no996_openfilm_project_sessions` | 历史记录，不再使用，**不要删** |
| 用户项目 | 用户自己的目录（`film.html` + 素材） | 用户；插件只经 Studio 的 `openProject` 注册 |
| 诊断文件 | `%TEMP%\dsh-openfilm-preset.json`、`%TEMP%\dsh-openfilm-frames.jsonl` | 插件；覆盖写，含截断 |

---

## 6. 安全模型（读一次，别踩线）

**信任域**

- 编辑器 Origin 被视为"本机这位用户的官方 OpenFilm 窗口"，与上游桌面端给自家窗口的信任一致。跨项目读取在该窗口内不被额外限制——
  但**项目 ID 每次都要通过 Studio 的实时项目列表校验**，伪造/过期 ID 会被拒。
- 官方 film 页面可含任意可执行 HTML/JS。**没有渲染沙箱**，也不要在 DSH Origin 里执行它们。
- 代理是**本机回环集成**，不是 OS/网络沙箱。Studio 自己用它自己的文件与进程权限，DSH 的工作区沙箱约束不到它。

**必须成立的校验（放松任何一条都是安全回归）**

1. 面板/路由只接受 `http://127.0.0.1:<port>` 的 DSH 浏览器 peer（`ctx.connection.admit`）。
2. 代理校验 cookie、`Host`、`Origin`，WebSocket 逐帧校验，禁止 `key`/`ticket` 出现在 URL。
3. 模板桥：仅浏览器 peer、仅本机 Host/Origin、仅 JSON、≤1 KiB、只认白名单 ID、只回项目 ID。
4. 文件名/白名单：`TEMPLATE_ID = ^[a-z0-9][a-z0-9-]{1,40}$`；模板根与模板本身都拒符号链接；文件数与体积有上限（4000 / 64 MiB）。
5. 错误响应只回固定词表，不回原始异常。

**明确没有做的**

- 预览、渲染、导出的沙箱与授权模型；
- `openfilm_draft` 的保存路径（需要另一套 CAS/冲突/授权设计）；
- `src/project-core.mjs` 是隔离实验，未注册进插件，**不可当授权边界**。

---

## 7. 构建、安装、发版

```sh
npm install                 # 只有 esbuild / openfilm / zod，无锁文件
npm run build               # src/studio-entry.js → client.js（esbuild，IIFE，es2022）
node --test tests/*.test.mjs
```

安装（profile 里已是指向本目录的链接，日常开发不需要重装）：

```
plugin_manager remove_bundle  target=dsh-openfilm
plugin_manager install_bundle target=F:/Dev/Desktop-Projects/dsh-openfilm
```

发版：改 `package.json` 版本 → 更新 `CHANGELOG.md` → 提交（`类型: 结论 版本号`）→ 推 `main`。

---

## 8. 热加载与重载

**结论：本插件不是热加载的，但可以热插拔。** 仓库里没有 watcher、没有 dev server，`scripts/build.mjs` 是一次性 esbuild 打包（无 `--watch`）；
插件被安装成指向工作目录的**链接**，所以"文件已经在位"。

Host 代码改完后执行 `plugin_manager set_plugin enabled=false` → `enabled=true`（target `include:dsh-openfilm`），加载器会**重新求值模块**，不必退出 DSH 应用。
**实测（2026-11-10）**：进程 21:34 启动，22:16 热插拔后，一个几分钟前才加的启动标记代码立即写出了 `%TEMP%\dsh-openfilm-host.json`。
（此前本节写的"必须重启 Host"是错的，已更正。）

| 改动 | 构建 | 生效 | 代价 |
|---|---|---|---|
| 客户端源码（`studio-entry.js` / `studio-panel.mjs` / `panel-keepalive.mjs`） | `npm run build` | 刷新页面 | iframe 重载，面板内未保存编辑丢失 |
| Host 源码（`index.js`、`src/*.mjs`，含代理注入） | 否 | **重载插件** + 刷新页面 | 刷新会重载 iframe；会话/项目保留 |
| `src/shell-extras.mjs`（官方页面注入） | 否 | 重载插件 + 刷新页面 | 同上 |
| `vendor/templates/**` | 否 | 下一次请求即时生效 | 无（面板列表需刷新页面重列） |
| `vendor/official-shell/ui/**` | 是（`scripts/build-official-shell.mjs` 重生成 manifest） | 重载插件（Studio 重启） | 手改不更新 manifest → `OFFICIAL_SHELL_UNAVAILABLE` |
| `cordis.patch.yml` | 否 | 重新安装或重载插件 | 既有会话不迁移 |
| `locale/*.json` | 否 | 刷新页面 | 无 |

**怎么确认真的是新代码**：看 `%TEMP%\dsh-openfilm-host.json` 的 `startedAt`/`version`。每次插件装配都会重写它；
时间没变 = 看到的还是旧代码，那时再考虑退出应用。

为什么不能靠 HMR：DSH 的客户端插件热替换只在使用 `pnpm run dev:web` 从同一 checkout 起服务时成立。本插件是已安装的第三方包，不在这条链路上。

**验证清单（缺一项就不算生效）**

1. `node --test tests/*.test.mjs` → 125 tests / 124 pass / 1 skip；
2. `POST /api/no996-openfilm/bootstrap` 返回 200（不是 503 错误码）；
3. 目标行为在真实界面可见；
4. 若改的是错误路径，确认 503 只回固定码、无隐私串。

---

### 8.1 运行日志（排查崩溃的第一站）

Host 侧所有关键事件写一份 JSON Lines 文件：

| 项 | 值 |
|---|---|
| 路径 | `%TEMP%\dsh-openfilm\plugin.log` |
| 轮转 | 超过 512 KB 时滚动为 `.1`（保留一份旧文件），因此不会无限增长 |
| 事件 | `host-start`（版本/端口/是否官方 shell）、`studio-warm`（毫秒）、`studio-warm-failed`、`host-stop`（存活时长/事件数）、`ticket-minted`、`ticket-redeemed`、`upstream-5xx`（方法/路径/状态）、`upstream-error`（连接失败）、`page-recovery-shown`、`page-restart-click` |
| 脱敏 | 键名含 key/secret/token/ticket/cookie/session/password 的一律 `[redacted]`；键名含 path/file/dir/folder/root/home/name 的一律写成 `sha256前10位:长度`。自由文本截断 200 字符 |
| 内存副本 | 最近 200 条常驻内存，`POST /api/no996-openfilm/diagnose` 返回最近 12 条（`log.tail`） |
| 上游 5xx 原文 | 另存 `%TEMP%\dsh-openfilm-errors.jsonl`（响应体截 800 字符），用来解释「删除失败」这类只有状态码的错误 |

页面侧只允许 4 个固定枚举（`recovery-shown`/`restart-click`/`picker-placed`/`session-expired`），经 `official-rpc` 的 `client:log` 通道上报；不接收任意文本，不接收项目内容。

读法：

```sh
tail -20 "$LOCALAPPDATA/Temp/dsh-openfilm/plugin.log"
grep '"level":"error"' "$LOCALAPPDATA/Temp/dsh-openfilm/plugin.log" | tail -5
```

**每次改完 Host 代码、重载插件之后，先看这两行**：`host-start.version` 是不是新版本、`studio-warm` 有没有失败。比“界面看起来没变”可靠。

### 8.3 桌面窗口是 `dsh-app://app`，不是 http（两条都必须记住）

DSH 桌面端用自定义协议加载界面。这不是"换个地址"，是**换了一套 URL 语义**：

**① 相对 `/api/...` 到不了 Host。** 页面在 `dsh-app://app` 时，`fetch('/api/no996-openfilm/bootstrap')` 被解析成 `dsh-app://app/api/...`，由协议处理器回答 **404**（它只认识自己的 `/api/file`、`/api/plugin`）。此时服务端一切正常——`curl` 打 `http://127.0.0.1:<port>/api/no996-openfilm/bootstrap` 会返回 401（路由在，只是缺登录态），这个 401 就是"路由没问题"的铁证。

需要 Host 数据的桌面前端，走回环控制台：

```
GET http://127.0.0.1:47821/api/studio-url   →   { "origin": "http://127.0.0.1:47822", "ticket": "…" }
```

- 不需要凭据；只返回一次性票据（60 秒、单次使用），所以 `Access-Control-Allow-Origin: *` 是安全的（不读也不写 cookie）；
- 拿到 `origin + ticket` 后，iframe 直接加载 `${origin}/__dsh/open#${ticket}`。

**② `frame-ancestors` 不写桌面协议 → 静默白屏。** 代理给票据页和编辑器页发的 CSP 原来是 `frame-ancestors <DSH 的 http 源> 'self'`。`dsh-app://app` 不在名单里，Chrome **直接拦掉 iframe**：页面里一行脚本都不跑，所以既没有票据兑换、也没有 boot 消息，面板只显示"官方界面 20 秒内没有回应"+ 一块白。现在统一用 `ancestorsFor(origin)`：

```
frame-ancestors <DSH 源> 'self' http://127.0.0.1:* http://localhost:* dsh-app: app:
```

只放开回环端口与桌面协议，远程站点依旧框不进来。

**排查这类问题的顺序**（三步定位，别猜）：

1. `curl -X POST http://127.0.0.1:<dsh port>/api/no996-openfilm/bootstrap` → 401 = 路由在；404 = 插件没挂；
2. 看页面自己的来源：错误信息已经带上了（`HTTP 404 @ dsh-app://app`，0.5.4 起）；
3. 看 `%TEMP%\dsh-openfilm\plugin.log` 的 `nav` 行——代理会记录每次**文档级导航**的路由、`sec-fetch-dest` 和是否带会话。正常链条是三行：

```json
{"event":"nav","route":"/__dsh/open","dest":"iframe","authed":false}
{"event":"ticket-redeemed","desktop":false,"active":1}
{"event":"nav","route":"/","dest":"iframe","authed":true}
```

只有第一行就断了 = 被 CSP 或协议拦了；中间缺 `ticket-redeemed` = cookie 没落地；第三行 `authed:false` = 会话丢了。

## 9. 调试

| 手段 | 用法 |
|---|---|
| 面板静默诊断 | 20 秒无 `boot` 自动显示 `{boot, diag}`，让用户整段贴回 |
| `POST /api/no996-openfilm/diagnose` | `{mode, studio, preset, proxy}` |
| 预设报告 | `%TEMP%\dsh-openfilm-preset.json`（`registered/ok/detail/raw/presets`） |
| 真实帧 | `%TEMP%\dsh-openfilm-frames.jsonl`（每轮覆盖，文本截断 200 字符） |
| 模板控制台 | `http://127.0.0.1:47821`（Host 代做 Studio 工作，浏览器不需要 cookie） |
| 调试地址 | `POST /api/no996-openfilm/debug-url` |
| 模板自证 | `node scripts/verify-templates.mjs`（需插件已加载；检查 3 模板可枚举、可安装、调试口响应） |

---

## 10. 测试

- `node --test tests/*.test.mjs`，当前 **116 / 115 pass / 1 skip**（跳过项需 `DSH_PINNED_SOURCE` 指向只读 DSH 源码）。
- 原则：只用 mock 与 `mkdtemp`；`OPENFILM_HOME` 指临时目录；不允许真实模型调用。
- 覆盖重点：分片翻译与顺序、事件流就绪与中断、错误分类与失败归因、模板复制/限额/链接拒绝、时间线未知时长、草稿原子性与冲突拒绝、面板导航与不确定创建。
- 真实项目注册测试会调用官方 `openfilm` 服务端 `openProject`，仍用临时 home。

---

## 11. 升级上游

`package.json` 的 tarball 版本、`src/official-shell.mjs` 的 `OFFICIAL_COMMIT`、`vendor/official-shell/manifest.json` 三者必须同步。
流程：读上游 release notes → 确认 `openfilm/studio` 的 `startStudio` 契约与鉴权/Origin 行为 → 更新 tarball URL → 干净 checkout 上跑 `scripts/build-official-shell.mjs` → 重跑测试 → 在真实 GUI 里验证面板、对话、上传、模板。

不要在运行时装 `latest`，也不要让版本号在多处各自漂移（`studio-runtime.mjs` 从 `package.json` 推导期望版本）。

---

## 12. 已知缺口

见 `../AGENTS.md` §9。要点：输入框只读、默认权限不是完全访问、预设实际激活未在真机确认、思考/工具显示只在单元测试里验证过、模板拆素材与首页改造未开工；
预览/导出/渲染未接通；审批不经插件。
