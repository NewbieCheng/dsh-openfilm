# 开发文档 — dsh-openfilm

> 面向接手本仓的人（或智能体）。最短操作约束看 [`../AGENTS.md`](../AGENTS.md)；接下来做什么看 [`ROADMAP.md`](ROADMAP.md)；为什么这么定看 [`NOTES.md`](NOTES.md)；已发布的改动看 [`../CHANGELOG.md`](../CHANGELOG.md)。
>
> 版本：`0.9.0`（未发布）· 上游 `openfilm@0.3.2` · Node 20+ · 全库 358 项测试（357 通过 / 1 跳过）

---

## 1. 它是什么

一个 DSH 插件：把官方 OpenFilm 视频工作台整页搬进 DSH 侧边栏的「视频创作」面板，并让**官方界面里的对话框使用 DSH 的模型与会话**。

```
┌────────────────────────── DSH Web 页面（127.0.0.1:<DSH 端口>） ──────────────────────────┐
│  侧边栏「视频创作」                                                                       │
│  ├─ main            → 占位（只上报选中状态，见 panel-keepalive）                          │
│  └─ shell.overlay   → 真面板（固定定位，跟随占位矩形），内含 iframe                        │
│                        iframe → http://127.0.0.1:47822/ （代理后的官方 Studio / 官方 shell）│
└───────────────────────────────────────────────────────────────────────────────────────────┘
│ 同源 fetch / SSE
┌────────────────────────── DSH Host 进程（Cordis Loader） ─────────────────────────────────┐
│  index.js → apply(ctx)                                                                     │
│  ├─ ctx.tools.register(openfilm_* × 10)      影片工具（只对本项目会话可见）                │
│  └─ createStudioController(ctx, startStudioProxy)                                          │
│       ├─ Studio 运行时（懒启动）：openfilm/studio.startStudio({port:0}) → 上游临时端口     │
│       ├─ 代理（每浏览器 Origin 一个）：监听 47822，校验 cookie/Host/Origin，转发 HTTP+WS    │
│       ├─ 官方对话桥：official-rpc → DSH Session；事件 → SSE                                 │
│       └─ 模板控制台：127.0.0.1:47821（可关）                                                │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

三条必须记住的：

- **Studio 上游只 bind 临时端口，key 不出 Host 进程**；浏览器只看得见代理端口 47822。
- **界面快照恰好 17 个文件有本地改动**，记录在 `vendor/official-shell/patch.diff`。改界面 = 改上游源码 + 重放补丁，**不要**运行时注入 DOM。
- 面板挂 `shell.overlay` 而不是 `main`，是为了切页不重载 iframe。

---

## 2. 启动时序

1. Host 启动，Loader 应用 `cordis.patch.yml`：插入 `dsh-openfilm` 插件行与 `openfilm-video-editing` 预设行。
2. `index.js` 的 `apply` 注册工具与控制器。控制器立刻做几件**非懒**的事：校验 DSH Web 源是 `127.0.0.1`、写预设激活报告（有界重试，预设行比插件晚挂载）、启模板控制台、订阅归档集合。
3. 用户点开面板 → `POST /api/no996-openfilm/bootstrap` → 首次装配：懒加载 `openfilm/studio`、校验版本、`startStudio({port:0})`、为这个浏览器 Origin 建代理、返回 `{editorOrigin, mode, webOrigin}`。
4. 面板校验返回地址（`http:`、同源 host、无 user/pass/path/query/hash）后设 iframe `src`。
5. iframe 通过 `postMessage` 上报 `boot` / `project`（项目 ID 存 `localStorage`）。
6. 20 秒没收到 `boot` → 面板显示诊断块，让用户整段贴回。

---

## 3. 请求路径

| 场景 | 路径 | 校验点 |
|---|---|---|
| 打开面板 | `POST /api/no996-openfilm/bootstrap` | DSH 浏览器 peer + 同源 surface |
| 诊断 | `POST /api/no996-openfilm/diagnose {projectId?}` | 只读；带项目时额外回每轮帧计数与归属状态 |
| 取图 | `GET /api/no996-openfilm/attachment?id=<64hex>` | 浏览器 peer + 只读附件库 + 64 位 hex |
| 归档状态/操作 | `POST /api/no996-openfilm/archive` | 浏览器 peer + 本机 Host/Origin + 1 KiB |
| 模板列表/创建 | `/api/no996-openfilm/templates`、官方 RPC `template:*` | 白名单 ID、独占创建、拒符号链接 |
| 对话发送 | `POST /__dsh/official-rpc {channel:'agent:prompt'}` | 项目 ID 每次经 Studio 实时列表校验 |
| 对话取消 | 同上 `agent:cancel` | 同上 |
| 流式回复 | `GET /__dsh/official-events?projectId=…`（SSE） | 项目作用域、每连接一次订阅、慢客户端断开 |
| 聊天历史 | 官方 shell → `chat:load` / `chat:save-*` / `chat:archive*` | 归档项目只读 |
| 文件上传 | `PUT /__dsh/official-upload?projectId&name` | 交给 Studio 自己的 `assets/upload` |
| 页面事件 | `POST /api/no996-openfilm/client-log` | 枚举值，≤512 字节 |

**失败语义**：只回固定错误码（`DSH_ORIGIN_REJECTED` / `DSH_BROWSER_REQUIRED` / `OFFICIAL_*` / `PROJECT_CONVERSATION_*`），不回原始异常；可选通道（`agent:thinking|models|permission|trace`、`chat:archive-state|log`）失败时降级为 `null` 并记日志，不弹红条。

---

## 4. 模块职责

### Host 编排

| 文件 | 职责 | 风险 |
|---|---|---|
| `index.js` | `inject` 声明与 `apply` | 加依赖会改变加载时序 |
| `studio-controller.mjs` | 控制器：路由、生命周期、代理工厂、`officialRpc`、系统提示、模板桥 | 高：所有信任判断汇集于此 |
| `studio-runtime.mjs` | 懒加载并校验上游版本，`startStudio` | 中：版本 pin 与上游契约耦合 |
| `studio-proxy.mjs` | 回环反向代理：cookie / Host / Origin 校验、WS 改写、`/__dsh/*` 桥 | 很高：放松任何一条都是安全回归 |
| `official-shell.mjs` | 校验 `vendor/official-shell/manifest.json`（版本、commit、逐文件 sha256） | 高：改 ui 必须重生成 manifest |
| `project-conversation.mjs` | 一个项目 = 一个 DSH Session：Workspace 归属、seat 复验、标题 | 高：会话归属在这里决定 |
| `project-markers.mjs` | 写 `.film/opened`：告诉内核 CLI「已经展示过」，它就不会再开浏览器窗口 | 低 |
| `workspace-archive.mjs` / `archive-bridge.mjs` | 归档集合的唯一 Host 视图 + 浏览器路由 | 高：浏览器可触达的状态写路径 |
| `official-templates.mjs` / `template-bridge.mjs` | 模板枚举与安装（独占创建、拒链接、限额） | 中 / 高 |

### 官方对话桥（面板的"灵魂"）

| 文件 | 职责 |
|---|---|
| `official-agent-service.mjs` | 建会话、`follow` 流、prompt/取消、终态、错误分类、帧记录、**逐轮诊断** |
| `official-agent-events.mjs` | 帧 → ACP 事件（文本 / 思考 / 工具 / 计划）+ 图片引用补全 |
| `official-chat-rpc.mjs` | 聊天 RPC（历史、模型、权限、归档状态） |
| `official-chat-store.mjs` | 项目会话历史存储（独立 storageDomain + revision 守卫；不读写上游 `.film/chat`） |
| `official-event-hub.mjs` / `official-event-stream.mjs` | 按项目 fan-out + SSE 写出 |
| `official-facade.mjs` | 注入页面的 `openfilmNative` 门面（RPC 白名单在这里） |
| `official-permission.mjs` / `official-turn-policy.mjs` | 权限状态与轮次策略 |
| `official-approvals.mjs` / `official-approval-bridge.mjs` | 审批通道（走 DSH 自己的界面，不静默放行） |

### 影片工具（10 个，只对项目会话可见）

`openfilm_film`（看片结构）、`openfilm_frame`（抽一帧/封面）、`openfilm_clip`（改片）、`openfilm_draft`（内存草稿）、`openfilm_assets`（素材）、`openfilm_library`（素材库）、`openfilm_get`（生成图/视频/音乐）、`openfilm_export`（导出）、`openfilm_cli`（**只留 `doctor`**）、`openfilm_guide`（用法）。

`openfilm_cli` 只留 `doctor` 是有原因的：`look` / `render` 会启动 Studio，而内核在项目没有 `.film/opened` 时会**在人的浏览器里打开一个剪辑窗口**。看画面用 `openfilm_frame`，导出用 `openfilm_export`。

### 客户端

| 文件 | 职责 |
|---|---|
| `studio-entry.js` | 侧边栏入口，注册 Slot |
| `studio-panel.mjs` | iframe 面板、超时诊断、bootstrap 重试 |
| `panel-keepalive.mjs` | 占位矩形上报，避免切页重载 |
| `assets/shell-ui.js` | 注入官方页面的脚本（**每次渲染读盘**，改完刷新即可，不 build） |

### 上游补丁（17 个文件）

权限菜单行、模型菜单分组与搜索、会话删除、思考可见且空块不画、模型名只显模型、**工具行显示真名**（`data-tool-name`）、**对话内联图片**（`kind:'image'` + `InlinePicture`）、底部只显「模型 · 思考强度」。

改法：`F:\Dev\_upstream\openfilm` 里改源码 → `pnpm --filter "@openfilm/desktop" build:shell` → `node scripts/build-official-shell.mjs <checkout>`（拒绝计划外的脏文件，并在 `patch.diff` 记录全部改动）。

---

## 5. 数据与存储

| 东西 | 在哪 |
|---|---|
| 项目 ↔ Session 绑定 | DSH `storageDomain`（`no996_openfilm_project_conversations`），只是提示；Session 才是真相 |
| 会话历史 | DSH `storageDomain`（`official-chat-store`），不碰上游 `.film/chat` |
| 附件（抽帧的图） | `<DSH_HOME>/attachments/v1/objects/<前2位>/<sha256>`，由 `/api/no996-openfilm/attachment` 只读转发 |
| 预设激活报告 | `%TEMP%\dsh-openfilm-preset.json` |
| 插件日志 | `%TEMP%\dsh-openfilm\plugin.log` |
| 帧记录 | `%TEMP%\dsh-openfilm-frames.jsonl` |

**永不删除**：用户 Session、上游 `.film/`、项目文件。`rebind` 只会新建一个空会话，旧会话原样保留。

---

## 6. 安全模型（读一次，别踩线）

- 编辑器 Origin 被视为"本机这位用户的官方窗口"；**项目 ID 每次都要经 Studio 实时列表校验**。
- 官方 film 页面可含任意可执行 HTML/JS，**没有渲染沙箱**；不要在 DSH Origin 里执行它们。
- 代理是回环集成，不是 OS 沙箱。

必须成立的校验（放松任何一条都是回归）：浏览器 peer（`ctx.connection.admit`）、代理的 cookie/Host/Origin、WS 逐帧、模板桥白名单 + 1 KiB、错误只回固定词表。

新增路由的模板：只收本机 DSH 浏览器、只读/只写明确字段、体积有上限、错误只回码。

---

## 7. 构建、安装、发版

```sh
npm install                              # esbuild / openfilm / zod
npm run build                            # src/studio-entry.js → client.js
node --test tests/*.test.mjs             # 全库；当前 358 / 357 通过 / 1 跳过
```

上游侧（只改界面时才需要）：

```sh
cd F:\Dev\_upstream\openfilm
pnpm --filter "@openfilm/desktop" exec tsc -p chat     # 类型
pnpm --filter "@openfilm/desktop" build:shell          # 产物
node scripts/build-official-shell.mjs F:\Dev\_upstream\openfilm
```

发版：改 `package.json` 版本 → 更新 `CHANGELOG.md` 与 `README` 里的数量 → `npm pack` → `gh release create` → 校验资产。

---

## 8. 改完怎么让它生效

| 改动 | 构建 | 生效 |
|---|---|---|
| `assets/shell-ui.js`、`vendor/official-shell/ui/**` | 否 | **刷新页面**（Ctrl+Shift+R） |
| 客户端源码（`studio-entry.js` / `studio-panel.mjs` / `panel-keepalive.mjs`） | `npm run build` | 刷新页面 |
| Host 源码（`index.js`、`src/*.mjs`） | 否 | **重启 DSH**（或 `plugin_manager set_plugin enabled=false→true`）+ 刷新 |
| `vendor/templates/**` | 否 | 下一次请求即时生效 |
| 上游界面源码 | `build:shell` + 快照脚本 | 重启 DSH |

---

## 9. 排查：先看这四个

| 手段 | 内容 |
|---|---|
| `POST /api/no996-openfilm/diagnose {projectId}` | `mode / studio / preset / proxy / permission / turns / grouping / log` |
| `%TEMP%\dsh-openfilm\plugin.log` | `official-rpc-failed`、`agent-thinking-unavailable`、`project-conversation-create`、`workspace-join`、`project-marker` |
| `%TEMP%\dsh-openfilm-frames.jsonl` | 原始帧（每次发送覆盖） |
| 面板静默诊断 | 20 秒无 `boot` 自动显示，用户可整段贴回 |

`turns[].verdict` 是"面板为什么是空的"的判词：`no-frames-received`（DSH 没产出）/ `nothing-emitted`（我们丢了）/ `some-frames-dropped` / `emitted`。`grouping` 说明会话是否真的在项目文件夹下（`seated` / `degraded`）。

---

## 10. 测试

- `node --test tests/*.test.mjs`；只用 mock 与 `mkdtemp`，`OPENFILM_HOME` 指临时目录，不调真实模型。
- 覆盖重点：事件翻译与顺序、思考与工具行、错误分类与归因、模板复制/限额/链接拒绝、草稿原子性与冲突、会话归属与 seat 复验、`.film/opened` 标记、CLI 动词收窄、诊断判词。
- 上游界面的断言在 `tests/kernel-shell-match.test.mjs`：它检查 `patch.diff` 里必须出现哪些标记（`data-thought`、`data-tool-name`、`kind: 'image'`、`InlinePicture`），所以改界面时补丁必须一起更新。

---

## 11. 升级上游

`package.json` 的 tarball 版本、`src/official-shell.mjs` 的 `OFFICIAL_COMMIT`、`vendor/official-shell/manifest.json` 三处必须同步；`studio-runtime.mjs` 从 `package.json` 推导期望版本。

流程：读上游 release notes → 确认 `startStudio` 契约与鉴权/Origin 行为 → 更新 tarball → 干净 checkout 上重放 `patch.diff` 的 17 个文件 → 重新生成快照 → 跑全库测试 + `tsc -p chat`。运行时不要装 `latest`。

---

## 12. 已知边界（不是 bug）

- DSH 的 Web GUI **无法嵌入**面板（跨源、无会话深链、无 embed 参数、`app.asar` 不可改）。所以"搬 DSH 的对话框"不存在，我们只搬表达。
- `window.openfilmNative` 是唯一消不掉的注入（网页没有原生桥）。
- 底部状态条（缓存命中 / 步数 / tokens）**故意不做**。
- 审批走 DSH 自己的界面；插件不会静默放行。
