<!-- doc
id: development
reader: 新开发者、智能体
fact-source: package.json、cordis.patch.yml、src/*.mjs、scripts/*
checked: 0.15.7
rot-if: 启动时序、请求路径、模块职责或构建方式变化
-->

# 开发文档 — dsh-openfilm / No996 Studio

> 最短操作约束看 [`../AGENTS.md`](../AGENTS.md)；改界面看 [`playbooks/ui-change.md`](playbooks/ui-change.md)；升级上游看 [`playbooks/upstream-bump.md`](playbooks/upstream-bump.md)；接下来做什么看 [`ROADMAP.md`](ROADMAP.md)，现在到哪了看 [`STATUS.md`](STATUS.md)。
>
> 版本与测试数量以 `package.json` 和 `node --test` 的实际输出为准，本文不抄数字（抄了就会过期）。

---

## 1. 它是什么

一个 DSH 插件：把官方 OpenFilm 视频工作台整页搬进 DSH 侧边栏的「视频创作」面板，并让官方界面里的对话使用 DSH 的模型与会话。

```text
┌──────────────────── DSH Web 页面（127.0.0.1:<DSH 端口>） ────────────────────┐
│ 侧边栏「视频创作」                                                            │
│ ├─ main          → 占位（只上报矩形，panel-keepalive）                        │
│ └─ shell.overlay → 真面板（fixed，跟随占位），内含 iframe                      │
│                     iframe → http://127.0.0.1:47822/                          │
└──────────────────────────────────────────────────────────────────────────────┘
│ 同源 fetch / SSE
┌──────────────────── DSH Host 进程（Cordis Loader） ──────────────────────────┐
│ index.js → apply(ctx)                                                         │
│ ├─ ctx.tools.register(openfilm_* × 10)     只对本项目会话可见                 │
│ └─ createStudioController(ctx, startStudioProxy)                              │
│    ├─ Studio 运行时：openfilm/studio.startStudio({port:0}) → 临时端口          │
│    ├─ 代理：47822，校验 cookie/Host/Origin，转发 HTTP+WS                       │
│    ├─ 官方对话桥：official-rpc → ACP 子进程（dsh --profile acp）；事件 → SSE │
│    ├─ 主题层：assets/theme/*.css 注入（开发期）                                │
│    └─ 调试控制台：127.0.0.1:47821（可关）                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

三条必须记住的：

- Studio 上游只 bind 临时端口，key 不出 Host；浏览器只看得见代理端口 47822。
- 界面改动分四层，**先判断层再选手段**（`playbooks/ui-change.md` §1–§3）。
- 面板挂 `shell.overlay` 而不是 `main`，是为了切页不重载 iframe。

---

## 2. 启动时序

1. Host 启动，Loader 应用 `cordis.patch.yml`：插入插件行与 `openfilm-video-editing` 预设行。
2. `index.js` 的 `apply` 注册工具与控制器。控制器立刻做非懒的事：校验 DSH Web 源是 `127.0.0.1`、写预设激活报告（有界重试）、启模板控制台、订阅归档集合。
3. 点开面板 → `POST /api/no996-openfilm/bootstrap` → 首次装配：懒加载 `openfilm/studio`、校验版本、`startStudio({port:0})`、为浏览器 Origin 建代理，返回 `{editorOrigin, mode, webOrigin}`。
4. 面板校验地址（`http:`、同源 host、无 user/pass/path/query/hash）后设 iframe `src`。
5. iframe 通过 `postMessage` 上报 `boot` / `project`（项目 ID 存 `localStorage`）。
6. 20 秒没收到 `boot` → 面板显示诊断块，让用户整段贴回。

`NO996_OPENFILM_DEV_SHELL=1` 时，编辑器目录换成 `.dev/shell`（`shell:dev` 的产物），跳过 manifest 校验；仅开发用，不要发布。

---

## 3. 请求路径

| 场景 | 路径 | 校验点 |
|---|---|---|
| 打开面板 | `POST /api/no996-openfilm/bootstrap` | DSH 浏览器 peer + 同源 surface |
| 诊断 | `POST /api/no996-openfilm/diagnose {projectId?}` | 只读；带项目时回每轮帧计数与归属 |
| 取图 | `GET /api/no996-openfilm/attachment?id=<64hex>` | 浏览器 peer + 只读附件库 |
| 归档 | `POST /api/no996-openfilm/archive` | 浏览器 peer + 本机 Host/Origin + 1 KiB |
| 模板 | `/api/no996-openfilm/templates`、RPC `template:*` | 白名单 ID、独占创建、拒符号链接 |
| 对话 | `POST /__dsh/official-rpc {channel:'agent:prompt'}` | 项目 ID 每次经 Studio 实时列表校验 |
| 取消 | 同上 `agent:cancel` | 同上 |
| 流式 | `GET /__dsh/official-events?projectId=…` | 项目作用域、每连接一次订阅 |
| 聊天历史 | RPC `chat:load` / `chat:save-*` / `chat:archive*` | 归档项目只读 |
| 上传 | `PUT /__dsh/official-upload?projectId&name` | 交给 Studio 自己的 `assets/upload` |
| 页面日志 | `POST /api/no996-openfilm/client-log` | 枚举值，≤512 字节 |

**失败语义**：只回固定错误码（`DSH_ORIGIN_REJECTED` / `DSH_BROWSER_REQUIRED` / `OFFICIAL_*` / `PROJECT_CONVERSATION_*`），不回原始异常；可选通道失败降级为 `null` 并记日志，不弹红条。

---

## 4. 模块职责

### Host 编排

| 文件 | 职责 | 风险 |
|---|---|---|
| `index.js` | `inject` 声明与 `apply` | 加依赖会改变加载时序 |
| `studio-controller.mjs` | 路由、生命周期、代理工厂、RPC、系统提示、模板桥 | 高：信任判断汇集于此 |
| `studio-runtime.mjs` | 懒加载并校验上游版本，`startStudio` | 中：版本 pin 与上游契约耦合 |
| `studio-proxy.mjs` | 回环反向代理、WS、`/__dsh/*` 桥、HTML 注入 | 很高：放松一条就是安全回归 |
| `official-shell.mjs` | 校验 manifest（版本、commit、逐文件 sha256） | 高：改 ui 必须重生成 manifest |
| `project-conversation.mjs` | 一个项目 = 一个 DSH Session | 高：会话归属在这里决定 |
| `workspace-archive.mjs` / `archive-bridge.mjs` | 归档集合的唯一 Host 视图 + 浏览器路由 | 高：浏览器可触达的写路径 |

### 对话桥（ACP）

面板的对话不再由 Host 手工模拟回合：`acp-client.mjs`（ndjson 线级客户端：initialize / session/new|resume|prompt / set_config_option / cancel）、`acp-agent-service.mjs`（每项目一个 `dsh --profile acp` 子进程；会话 id 存 `acp-session-store.mjs`；模型与思考走 configOptions；权限预设以 `DSH_PERMISSION_MODE` 在 spawn 时传给子进程）、`mcp-server.mjs`（Host 的 MCP 端点，把 `openfilm_*` 工具交给子进程，令牌按会话签发、滑动过期、随退出吊销）、`project-instructions.mjs`（首开项目写 `AGENTS.md`）。外层仍是：`official-chat-rpc.mjs`（RPC 白名单与校验）、`official-chat-store.mjs`、`official-event-hub.mjs` / `official-event-stream.mjs`（fan-out + SSE）、`official-facade.mjs`（注入页面的 `openfilmNative`）、`official-permission.mjs`（权限行与决策）、`official-approvals.mjs`（`session/request_permission` → 页面）。

旧路径（进程内回合服务、事件翻译层、Host 侧会话绑定、审批桥）已按 `docs/ARCHITECTURE.md §10` 删除；`NO996_OPENFILM_ACP` 变量不再存在。

### 影片工具（10 个，只对项目会话可见）

`openfilm_film`、`openfilm_frame`、`openfilm_clip`、`openfilm_draft`、`openfilm_assets`、`openfilm_library`、`openfilm_get`、`openfilm_export`、`openfilm_cli`（只留 `doctor`）、`openfilm_guide`。

`openfilm_cli` 只留 `doctor`：`look` / `render` 会启动 Studio，而内核在没有 `.film/opened` 时会在人的浏览器里开剪辑窗口。看画面用 `openfilm_frame`。

### 客户端

`studio-entry.js`（Slot 注册）、`studio-panel.mjs`（iframe、超时诊断、bootstrap 重试）、`panel-keepalive.mjs`（占位矩形）。`client.js` 是 `npm run build` 的产物，**不要手改**。

### 界面注入与主题

| 文件 | 职责 |
|---|---|
| `src/shell-extras.mjs` | 读 `assets/shell-ui.js` / `login-city.js` / `shell-login.js`（mtime 缓存） |
| `assets/shell-ui.js` | 官方壳的 DOM 叠加：模板、环境检查、账号条、故障卡 |
| `assets/shell-login.js` | 全屏登录页 |
| `src/theme.mjs` | 按 surface 读 `assets/theme/*.css` 并生成 `<style>` |
| `brand/brand.json` + `src/brand.mjs` | 产品名、颜色、链接、上游归属 |

### 上游补丁

`patches/series.json` + 每文件一个 `.patch`；`patch.diff` 是合并视图（生成物）。补丁放在 `vendor/official-shell` 之外，重新生成快照不会删掉它们。`scripts/build-official-shell.mjs` 打包快照，`scripts/upstream.mjs` 负责对账/重放。流程见 `playbooks/upstream-bump.md`。

---

## 5. 数据与存储

存什么、存在哪、哪些是真相哪些只是提示，见 [`reference/storage.md`](reference/storage.md)。

**永不删除**：用户 Session（只归档）、上游 `.film/`、项目文件（删除走回收站并由用户确认）。

## 6. 安全模型

三个信任假设、必须成立的校验、新增路由的模板，见 [`reference/safety.md`](reference/safety.md)。

一句话：这是本机回环集成，不是 OS 沙箱；注入层不承载权限、凭据、业务写操作。

## 7. 构建、安装、发版

```sh
npm ci
npm run check       # lint(strict) + test + docs/brand/templates/patches
npm run build       # src/studio-entry.js → client.js
npm run shell:bake  # 发版前把主题烘焙进 vendor/official-shell/ui
```

发版步骤（版本、CHANGELOG、STATUS、打包、回滚）见 [`playbooks/release.md`](playbooks/release.md)。

---

## 8. 改完怎么让它生效

| 改动 | 构建 | 生效 | 代价 |
|---|---|---|---|
| `brand/brand.json`、`assets/theme/*.css` | 否 | 保存 + 刷新 | iframe 重载，未保存编辑丢失 |
| `assets/shell-ui.js` / `login-city.js` / `shell-login.js` | 否 | 保存 + 刷新（读盘 + mtime） | 同上；改注入清单要重载 Host |
| `src/studio-entry.js` / `studio-panel.mjs` / `panel-keepalive.mjs` | **是** | 刷新 | 同上 |
| Host 源码 `index.js`、`src/*.mjs` | 否 | 重载插件（disable→enable）+ 刷新 | Studio 子进程重建 |
| `vendor/templates/**` | 否 | 下一次请求即生效 | 无 |
| `vendor/official-shell/ui/**` | 是（上游） | 部署产物后重启 Studio | 清单不匹配 → `OFFICIAL_SHELL_UNAVAILABLE` |
| `cordis.patch.yml` | 否 | 重新 `install_bundle` 或重启 Host | 已有会话不迁移 |

**重载前先 `touch index.js src/*.mjs`**：加载器只重新求值 mtime 变了的模块，未 touch 的引入方会继续用旧 import——症状就是"改了没生效"。`npm run dev` 会替你 touch。

**本插件默认不是热加载的。** DSH 的客户端 HMR 只在用 `pnpm run dev:web` 从同一 checkout 起服务时成立；本插件是已安装的第三方包，不在这条链路上。

管理器返回 `restart-required` 时：如实报告，并按 `nextStep` 完整重启 DSH；日志里的新 `host-start` 只证明 Host 重建，不证明 GUI 已应用。

---

## 9. 排查：先看证据

| 手段 | 内容 |
|---|---|
| `POST /api/no996-openfilm/diagnose {projectId}` | `mode / studio / preset / proxy / permission / turns / grouping / log / bridge` |
| `%TEMP%\dsh-openfilm\plugin.log` | JSON Lines，512 KB 轮转；密钥与路径自动脱敏 |
| `%TEMP%\dsh-openfilm-frames.jsonl` | 原始帧（每轮覆盖） |
| `%TEMP%\dsh-openfilm-host.json` | `{version,pid,startedAt}`；重载后必须更新 |
| `%TEMP%\dsh-openfilm-preset.json` | 预设 `registered/ok/detail/raw` |
| 面板静默诊断 | 20 秒无 `boot` 自动显示，可整段贴回 |

`turns[].verdict` 是"面板为什么是空的"的判词：`no-frames-received` / `nothing-emitted` / `some-frames-dropped` / `emitted`。`grouping` 说明会话是否在项目文件夹下。

**不要靠猜分片形状**：`official-agent-events.mjs` 的 bug 必须用真实 `type` 名反推。

---

## 10. 测试

- `npm test`（等价 `node --test tests/*.test.mjs`）；只用 mock 与 `mkdtemp`，`OPENFILM_HOME` 指临时目录，不调真实模型。
- 覆盖重点：事件翻译与顺序、思考与工具行、错误分类、模板复制/限额/链接拒绝、草稿原子性与冲突、会话归属、`.film/opened`、CLI 动词收窄、诊断判词。
- 上游界面断言在 `tests/kernel-shell-match.test.mjs`：检查补丁里必须出现的标记（`data-thought`、`data-tool-name`、`kind:'image'`、`InlinePicture`），改界面时补丁要一起更新。
- 新增行为必须带测试；本仓历史 bug 大多是"逻辑没问题但顺序/形状假设错"。
- CI（`.github/workflows/ci.yml`）跑 `windows-latest`：`npm ci` → lint → test → docs/brand/templates/patches → 无构建产物 → 工作区干净。**只在 Windows 跑是有意的**（支持面就是 Windows 桌面集成，见 workflow 顶部注释）；加系统进矩阵要同时做真机验收。
- 行尾统一 LF（`.gitattributes`）：Windows runner 默认 `core.autocrlf=true`，不锁行尾时逐字节比较与钉死哈希会在 runner 上假红。

---

## 11. 升级上游

见 [`playbooks/upstream-bump.md`](playbooks/upstream-bump.md)。一句话：`package.json` tarball、`manifest.version/commit`、`official-shell.mjs` 的 `OFFICIAL_COMMIT` 三处一起动；补丁按文件重放，冲突按文件报告；运行时不要装 `latest`。

---

## 12. 已知边界（不是 bug）

- DSH 的 Web GUI 无法嵌入面板（跨源、无会话深链、无 embed 参数、`app.asar` 不可改）。所以"搬 DSH 的对话框"不存在，我们只搬表达。
- `window.openfilmNative` 是唯一消不掉的注入（网页没有原生桥）。
- 底部状态条（缓存命中 / 步数 / tokens）**故意不做**。
- 审批走 DSH 自己的界面；插件不会静默放行。
- 上游快照不是字节级一致：有本地改动的文件全部记录在 `patches/series.json`，打包器拒绝计划外改动。
