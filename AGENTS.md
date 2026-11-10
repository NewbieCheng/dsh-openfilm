# AGENTS.md — dsh-openfilm

给在本仓工作的智能体的操作手册。人读版：`README.md`；架构与重载细节：`docs/DEVELOPMENT.md`；决策与历史：`docs/NOTES.md`。

> 本文件会被 `openfilm-video-editing` 预设里的 `@deepseek-ai/dsh-agent-instructions` 读入（`maxBytes: 65536`）。
> 保持精炼：新增内容优先写进 `docs/`，这里只留"必须知道才不犯错"的部分。

---

## 0. 一句话

把官方 **OpenFilm 0.3.1** 视频工作台封装成可分发的 **DSH 插件**：Host 侧拉起官方 Studio 并做反向代理，浏览器侧用 `shell.overlay` 常驻一个 iframe 面板显示官方界面，右侧官方对话经 Host RPC 桥到 DSH 会话（模型、审批、会话都是 DSH 的）。

当前版本 `0.4.0`，仓库 `NewbieCheng/dsh-openfilm`，分支 `main`。这是一个**早期可用但有缺口**的插件（见 §9 未完成清单），不是成品。

---

## 1. 红线（违反即回退）

1. **不碰用户既有项目和会话。** 模板安装只新建目录；不迁移、不删除、不改写别人的 `film.html`。
2. **自动化测试禁止真实模型调用。** 只用模拟对象和临时目录（`mkdtemp`）。
3. **只推 `NewbieCheng/dsh-openfilm`。** 绝不推 `不加班智能团-desktop`（那是历史分支，不作为交付物），也不改它的 `vendor/dsh`（只读参考）。
4. **未验证不得声称已完成。** 只有在本机真实 GUI 里看到行为，才能说"好了"。用户对"报漂亮但没验证"极度敏感。
5. **不要把 `openfilm_draft` 当保存。** 它是纯内存草稿（移动/裁剪/拆分），不落盘、不渲染、不导出。
6. **不要把 Studio 代理当安全边界。** 它是本机回环集成，不是 OS 沙箱；官方 film 页面可含任意可执行 HTML/JS，没有渲染沙箱。

---

## 2. 仓库地图

| 层 | 位置 | 职责 |
|---|---|---|
| Host 入口 | `index.js` | `inject` + `apply`：注册 `openfilm_draft` 工具、创建 Studio 控制器 |
| 组合补丁 | `cordis.patch.yml` | 插入 `dsh-openfilm` 插件行 + `openfilm-video-editing` 预设行及工具清单 |
| Host 编排 | `src/studio-controller.mjs` | 路由、Studio 生命周期、代理装配、官方对话/事件接线、系统提示上下文 |
| Studio 运行时 | `src/studio-runtime.mjs` | 懒加载 `openfilm/studio`，版本必须等于 `package.json` 里那条 tarball 的版本 |
| 代理 | `src/studio-proxy.mjs` | 回环反向代理：cookie / Host / Origin / WebSocket 校验，DESKTOP 票据 |
| 官方对话桥 | `src/official-agent-service.mjs`、`official-agent-events.mjs`、`official-chat-rpc.mjs`、`official-approvals.mjs`、`official-event-hub.mjs`、`official-event-stream.mjs`、`official-chat-store.mjs`、`official-facade.mjs`、`official-model-catalog.mjs` | DSH 会话 ↔ 官方 ACP 事件 |
| 模板 | `src/official-templates.mjs`、`src/template-bridge.mjs`、`vendor/templates/*` | 列举、复制、官方 `openProject` 注册；HTTP 桥鉴权 |
| 草稿工具 | `src/draft-tool.mjs`、`film-draft.mjs`、`film-operations.mjs`、`film-source.mjs`、`film-summary.mjs`、`timeline-*.mjs`、`draft-session.mjs` | 解析 `film.html`、生成摘要、内存内 move/trim/split |
| 客户端源码 | `src/studio-entry.js`、`studio-panel.mjs`、`panel-keepalive.mjs` | 注册 `main`(占位) / `sidebar.panellist`(图标) / `shell.overlay`(真面板) |
| 客户端产物 | `client.js` | **由 `npm run build` 生成，禁止手改** |
| 官方 shell | `vendor/official-shell/{manifest.json,ui,source}` | 上游桌面 shell 构建产物 + 哈希清单（不是本仓源码） |
| 测试 | `tests/*.test.mjs` | `node --test`，纯 Node，无浏览器 |

`src/client-entry.js` 是早期的工作区浏览 UI，**不在构建链里**（构建只以 `src/studio-entry.js` 为入口）。要删就单独提交，别顺手接进去。

---

## 3. 改一行的最短路径

```sh
npm run build                      # 只在改了客户端源码时需要
node --test tests/*.test.mjs       # 期望 114 tests / 113 pass / 1 skip
```

顺序：**先判断改的是哪一层 → 改 `src/` 源码 → build（如需）→ 跑测试 → 按 §4 让变更生效 → 在真实 GUI 里确认。**

跳过测试直接进 GUI 是本仓最常见的返工来源：`official-agent-events.mjs` 的失败全部是形状/顺序问题，只能在测试里先钉住。

---

## 4. 重载与热加载（最容易搞错的地方）

### 4.1 结论

- **本插件不是热加载的。** 仓库里没有任何 watcher 或 dev server，唯一的 npm 脚本是 `build`（esbuild 一次性打包，无 `--watch`）。
- **但不用重新安装。** profile 里 `~/.dsh/profiles/desktop/node_modules/dsh-openfilm` 是指向本工作目录的**链接**（实测 `readlink` → `F:\Dev\Desktop-Projects\dsh-openfilm`）。磁盘上的文件就是"已安装"的文件，改完不需要 `install_bundle` 才能看到。
- **"文件变了" ≠ "进程用了新代码"。** Node 的 ESM 模块在一个进程里只求值一次；浏览器里的 bundle 在页面加载时取一次。所以真正决定生效时机的是**哪一层**。

### 4.2 重载矩阵

| 改了什么 | 要 build | 怎么生效 | 代价 / 会丢什么 |
|---|---|---|---|
| 客户端源码 `src/studio-entry.js`、`studio-panel.mjs`、`panel-keepalive.mjs`（及其依赖） | **是** | **刷新页面**（F5） | iframe 重载，面板内未保存的编辑丢失 |
| 仅改 `client.js` 之外的客户端无关文件 | 不建议 | — | — |
| Host 源码 `index.js`、`src/*.mjs` | 否 | **重启 DSH Host**（关掉桌面端重开最稳） | 会话保留（已持久化）；Studio 子进程与代理重建，模板项目不动 |
| `vendor/templates/**`（`manifest.json`、`film.html`、页面） | 否 | **下一次请求即生效**（`listTemplates` 每次都读盘）；面板首页的列表要刷新页面重新 mount 才重列 | 无 |
| `vendor/official-shell/ui/**` | **是**，且必须用 `scripts/build-official-shell.mjs` 重生成 `manifest.json` | 重启 Studio（= 重载插件/重启 Host） | 未保存编辑丢失。**手改 ui 而不更新 manifest 会直接 `OFFICIAL_SHELL_UNAVAILABLE`**（启动时逐个文件校验 sha256） |
| `cordis.patch.yml` | 否 | 重新 `install_bundle` 或重启 Host | 已存在的会话不会被迁移或改写 |
| `locale/*.json` | 否 | 刷新页面（Host 读取） | 无 |

### 4.3 关于 DSH 的 HMR

DSH 的客户端插件热替换只在**用 `pnpm run dev:web` 从同一个 DSH checkout 起服务**时成立。本插件是已安装的第三方包，不在那条链路上——**不要把"改完自动热更"当前提**。忘记 `npm run build` 就刷新，看到的是上一版 bundle，这种假象已经浪费过时间。

### 4.4 生效之后怎么证明它真的生效了

1. `node --test tests/*.test.mjs` 通过（逻辑层）；
2. 面板能开（`/api/no996-openfilm/bootstrap` 200，不是 503 错误码）；
3. 目标行为在真实界面里出现（例如：思考流有内容、工具卡片出现、输入框可输入）。

只做到 1 不算完成。

---

## 5. 端口、来源与环境变量

| 项 | 值 |
|---|---|
| Studio 上游 | 官方 `startStudio({ port: 0 })`，临时端口，仅 Host 可见 |
| 编辑器代理 | `http://<web host>:47822`（`NO996_OPENFILM_EDITOR_PORT`） |
| 模板调试控制台 | `http://127.0.0.1:47821`（`NO996_OPENFILM_DEBUG_PORT`，设 `0` 关闭） |
| DSH Web 源 | 必须是 `http://127.0.0.1:<port>`，否则控制器直接抛错 |

| 变量 | 作用 |
|---|---|
| `NO996_OPENFILM_DSH_CHAT=1` | 退回"官方 Studio + 内嵌 DSH 对话列"，不用官方桌面 shell |
| `NO996_OPENFILM_EDITOR_PORT` | 编辑器代理端口，默认 47822 |
| `NO996_OPENFILM_DEBUG_PORT` | 模板控制台端口，默认 47821，`0` = 关 |

桌面端（`location.hostname === 'app'`）走 `127.0.0.2` + 一次性票据（`/__dsh/open#<ticket>`）：票据由代理发放、`bootstrap` 返回，**60 秒**内可兑换，最多 128 个并发凭据。

---

## 6. 诊断：先看证据，再改代码

| 证据 | 位置 | 说明 |
|---|---|---|
| 健康检查 | `POST /api/no996-openfilm/diagnose` | 面板静默 20 秒后直接把返回贴给用户 |
| 预设激活 | `%TEMP%\dsh-openfilm-preset.json` | `registered/ok/detail/raw/presets/attempt`；预设行比插件晚挂载，报告有界重试（10 秒）后才写 |
| 真实帧 | `%TEMP%\dsh-openfilm-frames.jsonl` | 0.3.4 起每轮写，文本截断 200 字符，用于对齐真实分片/事件名 |
| 调试地址 | `POST /api/no996-openfilm/debug-url` | 可粘进右侧浏览器的稳定入口 |
| 归档通道 | `POST /api/no996-openfilm/archive` | `{action:'state'\|'archive'\|'unarchive'\|'rebind', projectId}`，只认项目 ID |

**不要靠猜分片形状。** `official-agent-events.mjs` 的 bug 必须用 `frames.jsonl` 里的真实 `type` 名反推。

---

## 7. 测试规则

- `node --test tests/*.test.mjs`；当前 **114 tests / 113 pass / 1 skip**（跳过项需要 `DSH_PINNED_SOURCE` 指向只读 DSH 源码）。
- 只允许模拟对象与 `mkdtemp` 临时目录；`OPENFILM_HOME` 指到临时目录，绝不碰用户库。
- 真实项目注册验证可以跑官方 `openfilm` 服务端 `openProject`，但必须用临时 home。
- 新增行为必须带测试；本仓的历史 bug 大多是"逻辑没问题但顺序/形状假设错"，测试是唯一便宜的判断手段。

---

## 8. 代码风格与提交

- ESM（`"type": "module"`），无 TypeScript，无构建期代码生成（除 `client.js`）。
- Host 侧模块保持"纯函数 + 注入依赖"的形状：`createX(deps)`，不要在模块顶层做 IO。
- 注释写"为什么"，尤其是顺序、缓存、重试、失败归因这类决定。
- 提交信息用中文、`类型: 结论 版本号`，与历史一致：`fix: 首条消息 503 OUTCOME_UNKNOWN 与项目被永久锁死 0.3.1`。
- 版本号在 `package.json`，发版同时更新 `CHANGELOG.md`。

---

## 9. 当前未完成（按优先级，别写进"已完成"）

1. **官方输入框表现只读**：能力协商位不全（未开工）。
2. **默认权限不是完全访问**：`SessionCreateRequest` 没有权限字段，需建会话后用会话级接口设置（未开工）。
3. **预设实际激活未验证**：0.4.0 修掉了"报告太早、误报未注册"的时序 bug，但 `openfilm-video-editing` 行是否真的挂上仍未在真机确认；下次启动看 `preset.json` 的 `registered/broken/children`。
4. **0.4.0 的思考/工具显示只在单元测试里验证过**（真实帧夹具），还没在真机 GUI 里看到工具卡片。
5. **模板拆素材 + 首页改造**（新需求，未开工）：三模板拆成可检索素材单元；首页直进对话；"内置模板"移到对话下拉；隐藏"视频复刻"入口。

> 0.4.0 已修并从清单移除：归档会话导致的 `OFFICIAL_AGENT_NOT_STARTED` 误报、工具调用不显示、思考无内容（被 blocked 解释为"没有流"的那部分）、归档与 DSH 侧边栏不同步。

---

## 10. 踩过的坑（每条都真实发生过）

- 把"未归因失败"当永久失败 → 项目被永久锁死。现在：可重试。
- 新会话没有模型 → 首条消息必失败。现在：建会话后一次性采用宿主默认模型。
- 严格顺序规则丢弃实时增量 → 用户看不到思考和回复。现在：按 index 去重、允许中途接管和跳跃。
- 反向踩坑：把"正常 unchanged"当流失效 → 503。现在：已修（0.3.3）。
- 预设缺 `tool-fs-search.sampleOverCapGlobResults` → 整个预设 invalid config。
- 子智能体任务粒度过大，连续两次整体失败。现在：拆成单点任务逐个验证。
- 手改 `vendor/official-shell/ui` 不更新 manifest → 启动即失败（哈希校验）。
- 只按 `user/message` 归因准入 → 真实事件是 `agent/inbox/spliced`，归档会话的 `turn/end blocked` 被误判成 CONFLICT，页面只剩 503。现在：两种归因都认，`blocked` 单独成终态（0.4.0）。
- 绑定表不校验归档状态 → 四个项目全部指向已归档会话，每次发送都 503。现在：发送前探针 + 归档横幅（0.4.0）。
- 预设自报在预设行挂载前就读 roster → 永远报 "not registered"。现在：有界重试（0.4.0）。

---

## 11. 不要做

- 不要手改 `client.js`（会被 build 覆盖）。
- 不要给 `openfilm_draft` 加"保存/导出"，那需要另一套授权模型和冲突模型；`src/project-core.mjs` 是隔离实验，**没有注册进插件**，不要接到 UI 或工具上当授权边界。
- 不要升级 `openfilm` 依赖而不同步 `vendor/official-shell`（`manifest.commit` + 版本 + tarball 版本三处必须一起动）。
- 不要在浏览器侧接受任意 URL 当编辑器来源（面板会校验 origin/host/port/path）。
- 不要声称预览、导出、渲染已接通——它们都没接通。
