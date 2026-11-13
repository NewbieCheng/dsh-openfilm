# 界面地图：侧栏、面板与对话（开发定位用）

> 这份文档回答三个问题：**侧栏的“工作区”在哪、面板是怎么替换进去的、模型/思考/权限分别从哪来。**
> 以后要动侧栏或面板，先读这里，不要靠猜 DOM。最后更新：2026-11-13（0.13.1）。

---

## 1. 侧栏（工作区）在哪

### 1.1 代码归属

侧栏是 **DSH 自己的客户端插件**，不在本仓：

| 东西 | 位置 |
|---|---|
| 侧栏客户端包 | `@deepseek-ai/dsh-client-ui-sidebar`（随 DSH 安装，打进 `F:\apps\DSH_harness\resources\app.asar`） |
| 它挂在哪个 bundle | 桌面 profile 的 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`（见 `~/.dsh/profiles/desktop/package.json`） |
| 本仓有没有它的源码 | **没有**。asar 是打包产物，只能读字符串、不能直接改 |
| 本仓和侧栏的关系 | 只在 `src/studio-entry.js` 注册了一个 `sidebar.panellist` 入口（“视频创作”），别的什么都不碰 |

### 1.2 侧栏可用的官方插槽（从 DSH 客户端包里读到）

| 插槽 | 说明 | 能不能用 |
|---|---|---|
| `sidebar.workspaces` | **整块工作区**（标题 + 搜索/筛选/新建 + 列表） | **single 槽，独占**。占了就要重写整块，官方浏览器未导出。**不要用** |
| `sidebar.workspaces.session.row.action` | 会话行悬停按钮 | 行级，可用但会和会话菜单打架 |
| `sidebar.workspaces.session.menu.item` | 会话右键菜单项 | 同上 |
| `sidebar.session.row.trailing` / `.leading` / `.hover` | 会话行尾/行首/悬停 | 行级 |
| `sidebar.panellist` | 侧栏顶部的“面板”入口列表（我们的“视频创作”就在这） | **官方、稳定** |
| `sidebar.footer.action` | 侧栏底部动作按钮 | 官方、稳定 |
| `sidebar.settings` | 设置入口 | 官方 |
| `sidebar.right.pane.tab` 等 | 右侧面板页签 | 官方 |

**结论**：侧栏“工作区”标题那一行（含搜索/筛选/新建按钮）**没有官方插槽**；要动它只能 DOM 注入（B2）。注入的代价见 `docs/UI-PLAYBOOK.md` §6。

### 1.3 本仓的侧栏代码

| 文件 | 作用 |
|---|---|
| `src/studio-entry.js` | 客户端入口；`apply(ctx)` 里注册 `main`、`sidebar.panellist`、`shell.overlay` |
| `src/studio-entry.js:127` | `sidebar.panellist` 注册（“视频创作”入口） |
| `src/studio-entry.js:130` | `shell.overlay` 注册（真面板，切页不重载） |
| `src/studio-panel.mjs` | 面板 iframe、项目导航（`no996-openfilm:navigate` postMessage） |
| `src/panel-keepalive.mjs` | 面板常驻/显示隐藏 |
| `client.js` | **构建产物**，由 `scripts/build.mjs` 从 `studio-entry.js` 生成，禁止手改 |

### 1.4 “工作区”那行 DOM 怎么拿（不靠截图猜）

**已找到真实源码（2026-11-13，来自 DSH Web 端的 source map）**：

- 插件：`@deepseek-ai/dsh-client-ui-workspace`（客户端 bundle，不是本仓）
- 组件：`WorkspaceBrowser`
- 结构（源码里的 JSX，类名是 CSS Module 哈希，不要写死）：

```
div.root
  div.sectionHeader
    span.sectionLabel          ← 文本 t('section.workspaces') = “工作区”
                                 （groupBy === 'flat' 时是 t('section.sessions') = “会话”）
    div.searchSlot > div.search（button.searchButton + input.searchInput）
    div.headerActions          ← ViewOptionsMenu（筛选）+ button.iconButton（新建工作区）
  div.listArea                 ← 列表：SearchResults / FlatList / SessionTree
```

**怎么再次拿到源码**（web 实例的 bundle 带 source map）：

```sh
# 1) 从 Web 首页 HTML 里找 sidebar/workspace 的 bundle URL（带 rev）
# 2) 取 client.js.map，解析 sections[].map.sourcesContent
node -e "const m=JSON.parse(require('fs').readFileSync('.dev/tmp/workspace.map','utf8'));for(const s of m.sections)for(const c of s.map.sourcesContent||[])process.stdout.write(c)" > .dev/tmp/workspace-src.js
grep -n "section.workspaces" .dev/tmp/workspace-src.js
```

**注入锚点（不依赖哈希类名）**：

1. 找 `span`，`textContent.trim()` 是 `工作区` 或 `会话`，且它的父节点同时包含 `input`（搜索）和至少两个 `button`（筛选/新建）——这就是 `sectionLabel`；
2. 父节点就是 `sectionHeader`；`sectionHeader` 的**下一个兄弟**就是 `listArea`；
3. 在 `sectionLabel` 后插入下拉按钮；选“剪辑区”时把 `listArea` 设为 `display:none`，插入我们的列表；选“工作区”恢复；
4. MutationObserver 跟随 React 重渲染（标题文字会在“工作区/会话”之间切换）。

截图只能看位置，拿不到选择器；如果元素定位给的是 `src/client-entry.js:24`、`.tmp-frames/login-dom.js:57` 这类路径，**是误报**（那是客户端入口/登录页，不是侧栏组件），以本节源码为准。

---

## 2. 面板（DeepSeek Harness / 视频创作）怎么替换进去

```
DSH Web 壳（侧栏 + 主区域）
  └─ sidebar.panellist 入口（“视频创作”，本仓注册）
       └─ main 槽占位 → shell.overlay 里的 iframe（常驻）
            └─ OpenFilm Studio（官方 L2，dist）
                 └─ Studio 原生聊天列（apps/desktop/chat，上游源码）
                      └─ ACP（stdio）→ dsh --profile acp 子进程
```

| 层 | 代码 |
|---|---|
| 面板入口 | `src/studio-entry.js`（`sidebar.panellist` + `shell.overlay`） |
| 面板 iframe / 导航 | `src/studio-panel.mjs`（`postMessage({type:'no996-openfilm:navigate'})`） |
| Studio 启动 | `src/studio-runtime.mjs` → `startStudio({ editorDir })` |
| Studio 聊天 UI | 上游 `.upstream/openfilm/apps/desktop/chat/src`（`ModelPopover.tsx`、`agent-menu-rows.ts`、`local-agent-store.ts`） |
| 对话协议 | `src/acp-client.mjs`（ACP 线级客户端） |
| 会话/模型/权限 | `src/acp-agent-service.mjs`、`src/acp-session-store.mjs`、`src/official-permission.mjs` |
| 模型渠道同步 | `src/acp-profile-models.mjs`（把桌面 profile 的 `llm-pi-ai` 抄进 `acp` profile） |
| 会话存储 | `~/.dsh/sessions/<编码后的 cwd>/<session-id>/session.v4.jsonl.zstd`；映射在 `~/.dsh/no996-openfilm/acp-sessions.json` |

**关键**：面板里的聊天是 **Studio 原生聊天**，不是我们手写的界面；我们只负责“把 ACP 子进程接上”。所以改聊天菜单/权限，改的是上游 `chat/src`（A1 源码补丁）或 ACP 子进程给它的 `configOptions`，不是改我们的 DOM。

---

## 3. 模型 / 思考 / 权限分别从哪来（已用真子进程探测）

`dsh --profile acp` 的 `session/new` 只返回 **两个** config option：

| option | category | 取值 |
|---|---|---|
| `model` | `model` | 分组：`DeepSeek`、`DeepSeek Account`、`opencode-go`、`ChatGPT subscription`… |
| `reasoning_effort` | `thought_level` | `Provider default / Low / High / Max`（官方模型还有 `Off`） |

**没有 permission/mode 这个 option。** 面板里的“权限 完全访问（不再逐…）”不是 ACP 给的，而是 **DSH 的会话权限预设**：

- 子进程启动时用 `DSH_PERMISSION_MODE` 传入（`src/acp-agent-service.mjs` 的 `ensure()`）；
- 预设存在 `~/.dsh/storages/no996_openfilm_project_permissions`；
- 默认值 `danger-full-access`（`src/studio-controller.mjs` 的 `defaultPreset`）；
- 所以“换模型”不会、也不应该改变权限——权限是**项目级**，不是模型级。

**如果换到 opencode-go 后权限行变灰/消失**，那是 DSH 客户端 UI 的判断（模型菜单里 `mode`/`permissions` 行的可见性），不是 ACP 拒绝。要定位它，需要：
1. 确认你说的是 **DSH 主界面的模型菜单** 还是 **面板（Studio）里的菜单**；
2. 用元素定位点一下那个“权限”行，把源码/类名发我；
3. 同时看 `%TEMP%\dsh-openfilm\plugin.log` 有没有 `permission-hint-unavailable` / `acp-default-model-failed`。

---

## 4. “工作区改为下拉”的实施方案（已实现 0.13.2，窄注入）

**目标**：把“工作区”标题行做成下拉选择器：`工作区` / `OpenFilm 素材剪辑区`。搜索/筛选/新建按钮不动。

**注入点**：`sidebar.workspaces` 标题行（DSH DOM，见 §1.4 的采集办法）。

**做法**（窄注入，只追加）：
1. 在标题文字后插一个下拉箭头按钮（`data-no996-workspace-switch`），不替换标题、不碰右侧三个按钮；
2. 点开浮层两项：`工作区`（默认）/ `OpenFilm 素材剪辑区`；
3. 选“剪辑区”：把标题下面那块列表容器隐藏，插入我们的列表容器；选“工作区”恢复；
4. MutationObserver 跟随 React 重渲染；选择记在 `localStorage`；
5. 列表数据：Host 新增只读 `GET /api/no996-openfilm/editing-sessions`，返回 `{projectId, projectName, sessionId, title, updatedAt}`（来自 `acp-sessions.json` + 项目登记表，不调模型）；
6. 点击一条：打开“视频创作”面板并导航到该项目（`postMessage` 导航 + `localStorage.lastProject`），恢复该项目的 ACP 会话（现有映射）。

**必须同步改的约定**：
- `tests/sidebar-untouched.test.mjs`：从“零注入”改为“允许窄注入、仍禁止占用 `sidebar.workspaces` 单槽/行级菜单”；
- `docs/UI-PLAYBOOK.md` §6 注入登记表加一行，写明退出条件（DSH 提供官方槽后删除）。

**风险**：DSH 侧栏 DOM 一改就可能错位；搜索/筛选/新建不能动；这是全仓唯一碰侧栏的地方，出错可一键关闭（环境变量）。

---

## 5. 模型全兼容：现状与差距

| 项 | 现状 | 差距 |
|---|---|---|
| 桌面 profile 的渠道 | 已同步进 `acp` profile（`opencode-go`） | 无 |
| 网页 profile 的渠道 | **不同步**（按你要求） | 无 |
| 插件注册的渠道（ChatGPT subscription） | 出现在 **DSH 主界面** 菜单；面板的 `acp` profile 没有这个插件 | 要的话把 `dsh-codex-subscription` 也装进 `acp` profile（另议） |
| 默认模型 | 跟随 DSH 当前选择；兜底官方 V4.1 | 无 |
| 旧 V4 | 面板菜单隐藏 | 无 |
| 思考强度 | ACP `reasoning_effort`，随模型变化（opencode-go 没有 `Off`） | 正常 |
| 权限 | 项目级预设，默认完全访问；**不是模型菜单项** | 若 UI 变灰，是 DSH 客户端行为，需定位 |

---

## 6. 一句话给未来的自己

- 侧栏“工作区”是 DSH 的，不是我们的；改它只能注入，先拿真实 DOM。
- 面板聊天是 Studio 原生聊天 + ACP；改菜单改上游 `chat/src`，改模型给 `acp` profile 加渠道，改权限改项目预设。
- 会话在 `~/.dsh/sessions`，不在项目文件夹。
