# AGENTS.md — dsh-openfilm

给在本仓工作的智能体的操作手册。人读版：`README.md`；架构与重载细节：`docs/DEVELOPMENT.md`；决策与历史：`docs/NOTES.md`。

> 本文件会被 `openfilm-video-editing` 预设里的 `@deepseek-ai/dsh-agent-instructions` 读入（`maxBytes: 65536`）。
> 保持精炼：新增内容优先写进 `docs/`，这里只留"必须知道才不犯错"的部分。

---

## 0. 一句话

把官方 **OpenFilm 0.3.2**（内核）视频工作台封装成可分发的 **DSH 插件**：Host 侧拉起官方 Studio 并做反向代理，浏览器侧用 `shell.overlay` 常驻一个 iframe 面板显示官方界面，右侧官方对话经 Host RPC 桥到 DSH 会话（模型、审批、会话都是 DSH 的）。

当前版本 `0.6.1`，仓库 `NewbieCheng/dsh-openfilm`，分支 `main`。这是一个**早期可用但有缺口**的插件（见 §9 未完成清单），不是成品。

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
| 模板素材库 | `vendor/templates/_kit/`（`catalog.json` + 单元 + `render.mjs` + 各模板 `page.mjs`） | 单元 = 标记 + 样式 + 目录条目；三个模板的页面都由它生成 |
| 模板源数据 | `vendor/templates/<模板>/shots/*.json`、`replica-film/shots/*.content.html` / `*.anim.js` | 一个镜头一份数据；页面是产物 |
| 模板文档 | `docs/TEMPLATES.md` | 三个模板各自的模型、怎么加单元/镜头、自包含边界 |
| 草稿工具 | `src/draft-tool.mjs`、`film-draft.mjs`、`film-operations.mjs`、`film-source.mjs`、`film-summary.mjs`、`timeline-*.mjs`、`draft-session.mjs` | 解析 `film.html`、生成摘要、内存内 move/trim/split |
| Studio 工具面（0.7.0） | `src/studio-http.mjs`（唯一上游出口，key 不出 Host、错误打码）+ `frame-tool` / `film-tool` / `library-tool` / `get-tool` / `clip-tool` / `assets-tool` / `export-tool` / `cli-tool` | 全部 `when: ({agent}) => isProjectAgent(agent)`；只认绑定表里的 `projectId` + 相对路径 |
| 0.7.0 控制层 | `official-permission.mjs`、`official-thinking.mjs`、`official-turn-policy.mjs`、`official-approvals.mjs`、`official-approval-bridge.mjs`、`tool-call-act.mjs`、`bridge-trace.mjs` | 权限/思考强度/审批竞速/act 词典/三路观测 |
| 客户端源码 | `src/studio-entry.js`、`studio-panel.mjs`、`panel-keepalive.mjs` | 注册 `main`(占位) / `sidebar.panellist`(图标) / `shell.overlay`(真面板)。**面板没有模板首页**，打开就是官方 Studio |
| 官方界面注入 | `src/shell-extras.mjs`（读取器）+ `assets/shell-ui.js`（真正的脚本） | 往官方 shell 页面叠模板下拉 / 故障卡片 / 隐藏「视频复刻」；每次渲染读盘，改完刷新即生效 |
| 热更新教程 | `docs/HOT-RELOAD.md` | 三档热更新的具体做法与坑 |
| 归档 | `src/workspace-archive.mjs`、`src/archive-bridge.mjs` | DSH 归档集合的唯一 Host 视图 + `/api/no996-openfilm/archive` |
| 事件流 | `src/official-event-stream.mjs`、`official-event-hub.mjs` | SSE 写出与按项目 fan-out；**背压只排队不关闭**（0.4.2 修） |
| 客户端产物 | `client.js` | **由 `npm run build` 生成，禁止手改** |
| 官方 shell | `vendor/official-shell/{manifest.json,ui,source}` | 上游桌面 shell 构建产物 + 哈希清单（不是本仓源码） |
| 测试 | `tests/*.test.mjs` | `node --test`，纯 Node，无浏览器 |

`src/client-entry.js` 是早期的工作区浏览 UI，**不在构建链里**（构建只以 `src/studio-entry.js` 为入口）。要删就单独提交，别顺手接进去。

---

## 2.1 UI 定位与插件开发接手规范（所有模式适用）

此节供任何接手本仓的 agent 使用，**不依赖进入视频创作模式**；但是否自动加载本文件取决于当前 agent 的指令机制，未加载时应主动读取仓库根目录 `AGENTS.md`。用户给了端口，只说明可能有服务，不代表有浏览器控制权或已看见界面。不要另开服务器冒充现有页面。

### 先定位，再选修改层

1. 明确目标：用户给的元素定位结果、截图、按钮文案、所在页面/弹窗、期望变化；信息不足且会改变方案时再问。若收到 `dsh-element-source` 的「[元素定位]」，先读所给源码（有行号则定位对应行），展示相关代码并用一句话说明渲染内容，然后停下等待具体修改需求；定位结果不是修改授权。
2. 区分 **DSH 外壳 → OpenFilm 面板 → iframe 内官方 Studio/shell → 项目影片/模板页面**。不要把 iframe 内按钮当成 DSH Slot，也不要把影片内容当成工作台 UI。查看实际页面来源、定位路径及源码；浏览器不可用时依靠现有代码和用户证据，不猜 DOM 或宣称看过页面。
3. 官方页面的样式微调、附近新增按钮/弹窗：优先检查 `assets/shell-ui.js`，它由 `src/shell-extras.mjs` 注入；示例：模板选择弹窗、刷新按钮已在其中。修改时局部作用域、尽量使用稳定锚点，避免脆弱的自动生成类名或宽泛选择器；考虑上游 React 重渲染、重复注入及监听器清理，不能影响原有控件。不是所有上游行为都能安全用注入层实现。
4. DSH 面板的边框、加载/错误态、侧栏图标或面板本身：查 `src/studio-entry.js`、`src/studio-panel.mjs`、`src/panel-keepalive.mjs`；修改源码后 build，勿手改 `client.js`。影片画面和模板：查 `docs/TEMPLATES.md`，改模板源并按其构建流程生成，绝不直接覆盖用户项目。
5. 必须改官方 shell 内部而注入不够时，先说明代价和影响，使用固定版本的上游源码及构建产物，不改 `node_modules/openfilm`。`scripts/build-official-shell.mjs` 是**打包预先构建好的固定上游 dist**，不是构建器，也不会覆盖已有 `vendor/official-shell`；运行前先读脚本、确认输入与目标，禁止为运行脚本擅自删除现有目录。上游改动的构建与清单校验需另行设计并验证，不能假设直接重算 manifest 就足够。

### UI 实现与验证

- 小改遵循现有布局、文案、主题及交互，不为单个按钮重做页面；使用语义化按钮、可见焦点和可访问名称。弹窗考虑键盘打开、Escape/关闭、焦点进入与返回、遮罩、窄屏及滚动；异步操作要有加载、失败及防重复提交状态。只接真实存在且经授权的动作，不能用假按钮冒充功能。
- 涉及项目、会话、删除、归档或其他持久化操作时，先核对现有 Host 服务/桥的权限与错误语义；不要在浏览器绕过校验、暴露凭据、任意扩大代理权限或以 UI 隐藏替代授权。需要新接口时同时覆盖 Host、边界与测试。
- 先检查当前安装是否确实指向本仓，不能假定其他环境也有 §4 所述链接。按 §4 / `docs/HOT-RELOAD.md` 选生效方式：注入脚本保存后刷新 Studio；客户端源码 build 后刷新 DSH；Host 修改需按管理器结果重载或重启再刷新。操作前提醒用户保存未保存编辑；任何插件管理动作都影响整个 profile，按当前工具授权执行。不要把 watcher 或热更新当成已启动。
- 新增行为按 §7 加自动化测试；至少检查目标按钮及原控件、弹窗开关/键盘、重渲染和相应错误态。可操作真实 GUI 时在用户现有页面确认；不可操作时明确写「源码/测试已验证，真实 GUI 未验证」和用户可执行的刷新及检查步骤，不声称视觉效果已完成。

### DSH/Cordis 插件开发规范

- 先改本仓已有插件，不为一次 UI 微调新建或安装另一个插件。理解 Host 的 `index.js` / `cordis.patch.yml`、Client 的 `src/studio-entry.js` 和 `package.json` 声明；涉及 DSH 原生扩展点时，有 `cordis-plugin-development` skill 就先加载；改预设/组合时加载 `editing-cordis-compositions`。没有这些 skill 的 agent 仍可按本节和仓库文档继续，不得虚构 API。
- 需要 DSH API 时先 `cordis_inspect_list`，再按返回的 provider/method 查询 Service、Event、Config、Tool；原生 UI 先查 Client `Slots.listSubTree` 的实时树及目标 slot 的注册选项/props，主题查 `Theme`。Inspect 只读，不能当业务接口调用；不可用时查已安装包的 README/类型或本仓现有实现，仍无法确认就报告阻塞，不猜方法名。用户操作应复用 Host 业务服务，Client 只负责显示与交互。
- 插件包、补丁、依赖、locale、图标、导出资源和测试保持一致；客户端通过现有 ModuleLoader/Slot 注册并清理 effect，Host 通过注入依赖并在 dispose 时释放资源。安装/启停只在任务确有需要及获得授权时使用 `plugin_manager`，不要手改 profile 配置；以返回的 `application` / `nextStep` 为准，不能只凭日志判断已经生效。详细架构见 `docs/DEVELOPMENT.md`，重载见 §4。

---

## 3. 改一行的最短路径

```sh
npm run build                      # 只在改了客户端源码时需要
npm run templates:build            # 改了 vendor/templates/_kit 或 shots/*.json 时必须
npm run templates:check            # 只校验页面与源是否一致
node --test tests/*.test.mjs       # 最近一次 193 tests / 192 pass / 1 skip
```

顺序：**先判断改的是哪一层 → 改对应源文件 → build（如需）→ 跑测试 → 按 §4 让变更生效 → 在真实 GUI 里确认。**

跳过测试直接进 GUI 是本仓最常见的返工来源：`official-agent-events.mjs` 的失败全部是形状/顺序问题，只能在测试里先钉住。

---

## 4. 重载与热加载（最容易搞错的地方）

### 4.1 结论

- **本插件默认不是自动热加载的**（`npm run build` 是一次性打包；`npm run dev` 才启动 watcher），部分环境支持热插拔：
  `plugin_manager set_plugin enabled=false` → `enabled=true`（target `include:dsh-openfilm`）可能触发 Host 重新装配；以管理器返回的 `application`/`nextStep` 为准，不能一概保证立即生效。
  > 实测（2026-11-10）：进程 21:34 启动，22:16 热插拔后，新加的启动标记代码立即写出了 `%TEMP%\dsh-openfilm-host.json`。这条推翻了我此前“必须重启应用”的说法。
- **但浏览器里还是旧页面**：Host 重载只换服务端；iframe 里的 HTML、以及 `client.js`，都要**刷新页面**才换。
- **注入 UI 是例外，几乎不用重载**：`assets/shell-ui.js` 在每次页面渲染时读盘（mtime 缓存），**保存 + 刷新页面**即可，不需要 build、不需要重载插件。三档热更新的做法见 `docs/HOT-RELOAD.md`。
- **重载前先 `touch index.js src/*.mjs`**（`npm run dev` 会自动做）：加载器只重新求值 mtime 变了的模块，未被 touch 的引入方会继续用旧 import——症状就是"改了没生效"。
- **不用重新安装。** profile 里 `~/.dsh/profiles/desktop/node_modules/dsh-openfilm` 是指向本工作目录的**链接**（实测 `readlink` → `F:\Dev\Desktop-Projects\dsh-openfilm`）。磁盘上的文件就是"已安装"的文件。
- 管理器返回 `restart-required` 时须告知用户完整重启 DSH；即使日志出现新的 `host-start`/`studio-warm`，也只证明 Host 重建，不能证明全部插件状态或 GUI 已应用。

### 4.1.1 三件套，按顺序做

```sh
npm run build F:/Dev/Desktop-Projects/dsh-openfilm      # 只有改了客户端源码才需要
plugin_manager set_plugin enabled=false target=include:dsh-openfilm
plugin_manager set_plugin enabled=true  target=include:dsh-openfilm
# 然后浏览器 Ctrl+Shift+R 刷新页面
```

改完 Host 代码后先看 `%TEMP%\dsh-openfilm-host.json` 的 `startedAt`/`version`：没变说明重载没生效（那时才考虑重启应用）。

### 4.2 重载矩阵

| 改了什么 | 要 build | 怎么生效 | 代价 / 会丢什么 |
|---|---|---|---|
| 客户端源码 `src/studio-entry.js`、`studio-panel.mjs`、`panel-keepalive.mjs`（及其依赖） | **是** | **刷新页面**（F5） | iframe 重载，面板内未保存的编辑丢失 |
| 仅改 `client.js` 之外的客户端无关文件 | 不建议 | — | — |
| Host 源码 `index.js`、`src/*.mjs`（含代理注入、SSE、会话桥） | 否 | **重载插件**（disable→enable）+ **刷新页面** | 刷新会重载 iframe，未保存编辑丢失；会话/项目保留，Studio 子进程重建 |
| `vendor/templates/**`（`manifest.json`、`film.html`、页面） | 否 | **下一次请求即生效**（`listTemplates` 每次都读盘）；面板首页的列表要刷新页面重新 mount 才重列 | 无 |
| `vendor/official-shell/ui/**` | 需上游构建和配套清单，先读 §2.1 | 验证并部署产物后重启 Studio | 未保存编辑丢失；清单不匹配会 `OFFICIAL_SHELL_UNAVAILABLE`。打包脚本不会覆盖已有目录，也不构建上游 |
| `cordis.patch.yml` | 否 | 重新 `install_bundle` 或重启 Host | 已存在的会话不会被迁移或改写 |
| `assets/shell-ui.js`（注入到官方页面的 UI/隐藏规则） | 否 | **保存 + 刷新页面**（每次渲染读盘，mtime 缓存） | 刷新会重载 iframe |
| `src/shell-extras.mjs`（读取上面的文件，几乎不用改） | 否 | 重载插件 + 刷新页面 | 同上 |
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

**桌面窗口的页面来源是 `dsh-app://app`，不是 http。** 这改变了两件事，都得按桌面处理：

1. 页面里的相对 `/api/...` 会被协议处理器回答 **404**，永远到不了 Host。需要 Host 数据时，从回环控制台取：`GET http://127.0.0.1:47821/api/studio-url` → `{origin, ticket}`（无凭据、只发一次性票据）。
2. 任何写着 `frame-ancestors <http 源>` 的响应头，都必须把 `dsh-app:`/`app:` 与回环端口列进去，否则 iframe 被静默拦掉——页面里一行脚本都不会跑，表现为**纯白**而不是报错。

---

## 6. 诊断：先看证据，再改代码

| 证据 | 位置 | 说明 |
|---|---|---|
| 健康检查 | `POST /api/no996-openfilm/diagnose` | 面板静默 20 秒后直接把返回贴给用户 |
| 预设激活 | `%TEMP%\dsh-openfilm-preset.json` | `registered/ok/detail/raw/presets/attempt`；预设行比插件晚挂载，报告有界重试（10 秒）后才写 |
| 真实帧 | `%TEMP%\dsh-openfilm-frames.jsonl` | 0.3.4 起每轮写，文本截断 200 字符，用于对齐真实分片/事件名 |
| 调试地址 | `POST /api/no996-openfilm/debug-url` | 可粘进右侧浏览器的稳定入口 |
| Host 构建标记 | `%TEMP%\dsh-openfilm-host.json` | `{version,pid,startedAt}`；重载插件后 `startedAt` 必须更新，否则说明你看到的还是旧代码 |
| 运行日志 | `%TEMP%\dsh-openfilm\plugin.log` | JSON Lines，512 KB 轮转；`host-start`/`studio-warm`/`host-stop`/`studio-health`/`bootstrap-*`/`ticket-*`/`upstream-5xx`/`upstream-error`/`page-*`；密钥与路径自动脱敏。**排查崩溃先读这个**，`diagnose` 也会带回最近 12 条 |
| 上游 5xx 原文 | `%TEMP%\dsh-openfilm-errors.jsonl` | 上游返回 5xx 时的响应体（截 800 字符），用于解释「删除失败」这类没有文案的错误 |
| 归档通道 | `POST /api/no996-openfilm/archive` | `{action:'state'\|'archive'\|'unarchive'\|'rebind', projectId}`，只认项目 ID |

**不要靠猜分片形状。** `official-agent-events.mjs` 的 bug 必须用 `frames.jsonl` 里的真实 `type` 名反推。

---

## 7. 测试规则

- `node --test tests/*.test.mjs`；最近一次 **193 tests / 192 pass / 1 skip**（跳过项需要 `DSH_PINNED_SOURCE` 指向只读 DSH 源码）。
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
3. **思考/工具卡片还没在真机 GUI 里看到过**：0.4.0/0.4.1 只用真实帧夹具在单元测试里验证；下一次发送要确认卡片出现。
4. **模板字体子集化**（未开工）：`sketchnote/assets/fonts.css` 10.4 MB 内嵌字体，影响首屏体积，不影响画面。
   模板拆素材已在 0.6.0 完成（`vendor/templates/_kit/`，见 `docs/TEMPLATES.md`）；首页直进对话、模板下拉、隐藏「视频复刻」在 0.4.2 完成。

> 0.4.x 已修并从清单移除：归档会话导致的 `OFFICIAL_AGENT_NOT_STARTED`、工具调用不显示、思考无内容、归档与 DSH 侧边栏不同步、注入指令被当并发输入、预设自报误报未注册（真机已确认 `registered:true, ok:true`）。

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
- 把注入的 AGENTS.md 块当并发输入 → 每轮 CONFLICT → `OFFICIAL_AGENT_OUTCOME_UNKNOWN`。注入的 `user/message` 带 `source.kind:'agent-instructions'`，不是人。现在：只有 `kind:'user'` 且 rpcId 不匹配才算冲突（0.4.1）。
- **把「重启插件」当成万能药**：面板报 `HTTP 404` 时连着重载三次都没用，因为请求根本没到 Host。教训：先分清「服务端坏了」和「浏览器没发对地方」——`curl` 打同一个路由（401＝路由在）+ 看页面自己的 `location.origin`，两步就能分开。错误信息里带上来源（`HTTP 404 @ dsh-app://app`）比任何猜测都快（0.5.4）。
- **只在 http 语境下设计前端**：相对路径 `/api/...`、`frame-ancestors <http 源>`，在 `dsh-app://app` 下分别是 404 和静默白屏。桌面端不是「浏览器换个地址」，是**换了一套 URL 语义**（0.5.5 / 0.5.7）。
- **把 404 当终态**：插件重载有几百毫秒路由空窗，落在窗口里的请求会 404 并被面板记成错误。现在：`404/503` 先静默重试两次（0.5.3）。
- **模板页面引用模板目录之外的文件**：模板安装是整目录复制，`../../_kit/…` 在仓库里能跑、复制进项目就 404。现在：共享样式由构建合并成 `<模板>/assets/kit.css`，并有测试扫 `href`/`src`（0.6.0）。
- **手写 `at` 与 `#t=`**：镜头墙的时间轴与镜头自己的时长一旦不一致，影片照播、内容错位。现在：`film.html` 由 `shots/*.json` 生成（0.6.0）。
- **服务断线后点击重启却白屏**：不要把调试地址跳转当成真正重启；面板应重新 bootstrap、上游应实际健康探测并在失联时清理旧实例/代理，重载可能使旧 iframe 凭证失效。iframe 后续导航也需重新计时，不能只检查首次启动。当前已有代码和模拟测试，**尚未完成真实 GUI 断线恢复验证**；排障细节见 `docs/NOTES.md`。
- **重载结果与实际日志不能混为一谈**：2026-11-11 管理器两次返回 `restart-required`，但同时观测到新的 `host-start`/`studio-warm`。必须同时报告这两项，不能由启动标记推断所有变更已应用；应按管理器提示完整重启 DSH 并在真实 GUI 验证。
- **日志字段名撞脱敏规则**：`path`/`session`/`cookie` 这类键会被写成 `[redacted]` 或哈希，日志看着"有了"其实没用。写日志时换名字（`route`/`authed`），或先跑一次 `redact()` 看输出（0.5.1 / 0.5.8）。

---

## 11. 不要做

- 不要手改 `client.js`（会被 build 覆盖）。
- 不要给 `openfilm_draft` 加"保存/导出"，那需要另一套授权模型和冲突模型；`src/project-core.mjs` 是隔离实验，**没有注册进插件**，不要接到 UI 或工具上当授权边界。
- 不要升级 `openfilm` 依赖而不同步 `vendor/official-shell`（`manifest.commit` + 版本 + tarball 版本三处必须一起动）。
- 不要在浏览器侧接受任意 URL 当编辑器来源（面板会校验 origin/host/port/path）。
- 不要声称预览、导出、渲染已接通——它们都没接通。
