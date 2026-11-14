<!-- doc
id: ui-layers
reader: 改界面的人、智能体
fact-source: src/studio-entry.js、src/theme.mjs、DSH 客户端包（source map）、推进记录见 ADR-0002/0006
checked: 0.15.6
rot-if: 层数变化、DSH 为侧栏开出官方插槽、或上游提供源码
-->

# 界面分层与定位

> 回答两个问题：**这块界面属于哪一层？从哪来？**
> 应该怎么改、走哪一级手段，看 [`../playbooks/ui-change.md`](../playbooks/ui-change.md)。

## 1. 四层

| 层 | 页面 | 源码归属 | 能不能改源码 |
|---|---|---|---|
| L0 DSH 外壳 | 侧边栏、面板边框、加载/错误态 | 本仓 `src/studio-entry.js`、`studio-panel.mjs` | 能，完全自己的 |
| L1 官方桌面壳 | 项目列表、对话、登录、首次引导 | 上游 `apps/desktop/*`，产物在 `vendor/official-shell/ui` | 能，但要源码补丁 + 重建 |
| L2 Studio 编辑器 | 时间轴、画布、素材库 | 上游 monorepo 的 `packages/openfilm/studio/ui/src`，随桌面壳一起构建进 `vendor/official-shell/ui`；npm 包的 `studio/ui/dist` 只在我们没传 `editorDir` 时兜底 | 能，与 L1 同一条补丁链路（ADR-0009） |
| L3 影片/模板页 | 用户项目里的 `film.html` | 本仓 `vendor/templates/*` | 能，改模板源并重建 |

**判断顺序**：先看 URL 和所处容器，再决定手段。
- `dsh-app://` 或 DSH 端口 → L0；
- iframe 内 `/` → L1；
- `/projects/<id>` → L2；
- `/film/...` → L3。

把 iframe 里的按钮当成 DSH 插槽、把影片内容当成工作台 UI，是这里最常见的错误。

## 2. 手段与落点

| 级别 | 手段 | 适用 | 生效 |
|---|---|---|---|
| **token** | `brand/brand.json` + `assets/theme/tokens.css` | 颜色、圆角、间距、字体 | 保存 + 刷新 |
| **A1** | 上游源码补丁（TS/React） | 结构、交互、文案、增删控件 | 重建壳 → 刷新 |
| **A2** | 构建期样式覆盖（CSS 进产物） | L1 纯样式，要随包发布 | 重建/打包 → 刷新 |
| **B1** | 样式注入 | L2 编辑器；L1 快速试色 | 保存 + 刷新 |
| **B2** | DOM/行为注入 | 只有 A1 做不到、且必须动 DOM | 保存 + 刷新 |

**A2 与 B1 是同一份文件**：`assets/theme/shell.css` 开发期由代理注入，发版前 `npm run shell:bake` 烘焙进 `vendor/official-shell/ui` 并重算 manifest。样式注入不是永久债，是同一份源码的两种消费方式。

## 3. 主题文件

```text
brand/brand.json          ← 产品名、颜色、链接、上游归属（唯一事实来源）
assets/theme/tokens.css   ← 非品牌 token：圆角、间距、动效曲线
assets/theme/shell.css    ← L1 覆盖
assets/theme/studio.css   ← L2 覆盖
src/theme.mjs             ← 读取 + 注入（按 surface 注册表 THEME_SURFACES）
```

- 品牌色由 `brand.json` 生成 `--n996-*`，注入在 tokens 之前；
- 新增界面：`THEME_SURFACES` 加一行 + 新建 CSS，不用改代理；
- 关断开关 `NO996_OPENFILM_THEME=0`：所有注入样式消失，用来判断"是不是主题导致的"；
- 注入失败（文件缺失、CSS 里有 `</style>`）时整块不注入，页面照常工作——样式永远不能把应用弄白。

## 4. 侧栏「工作区」那一行

### 4.1 归属

侧栏是 **DSH 自己的客户端插件**（`@deepseek-ai/dsh-client-ui-sidebar`），打进 `app.asar`。本仓与它的唯一关系：`src/studio-entry.js` 注册了 `sidebar.panellist` 入口（「视频创作」）与 `shell.overlay` 面板。

可用插槽（DSH 0.15 实测）：`sidebar.workspaces`（single，**不要占**）、`sidebar.workspaces.session.row.action`、`sidebar.workspaces.session.menu.item`、`sidebar.session.row.trailing/.leading/.hover`、`sidebar.panellist`、`sidebar.footer.action`、`sidebar.settings`、`sidebar.right.pane.tab`。
**「工作区」标题行本身没有官方插槽。**

### 4.2 真实结构（来自 DSH Web 端 source map）

组件 `WorkspaceBrowser`（`@deepseek-ai/dsh-client-ui-workspace`）：

```text
div.root
  div.sectionHeader
    span.sectionLabel          ← t('section.workspaces') = 工作区（flat 分组时是「会话」）
    div.searchSlot > div.search（button.searchButton + input.searchInput）
    div.headerActions          ← ViewOptionsMenu + button.iconButton（新建）
  div.listArea                 ← SearchResults / FlatList / SessionTree
```

类名是 CSS Module 哈希（形如 `a1b2c_sectionHeader`），**不要写死**。

### 4.3 重新拿到源码的办法

```sh
# 1) 从 Web 首页 HTML 找 sidebar/workspace 的 bundle URL（带 rev）
# 2) 取 client.js.map，把 sections[].map.sourcesContent 拼起来
node -e "const m=JSON.parse(require('fs').readFileSync('.dev/tmp/workspace.map','utf8'));for(const s of m.sections)for(const c of s.map.sourcesContent||[])process.stdout.write(c)" > .dev/tmp/workspace-src.js
grep -n "section.workspaces" .dev/tmp/workspace-src.js
```

### 4.4 可用锚点

1. 找 `span`，`textContent.trim()` 是「工作区」或「会话」，且父节点同时含 `input` 与至少两个 `button` → 这就是 `sectionLabel`；
2. 父节点是 `sectionHeader`，它的下一个兄弟是 `listArea`；
3. 插入按钮、隐藏列表，MutationObserver 跟随 React 重渲染（标题文字会在两值间切换）。

如果元素定位给的是 `src/client-entry.js:24`、`.tmp-frames/login-dom.js:57` 这类路径，那是客户端入口/登录页，**不是侧栏组件**——以本节为准。

## 5. 模型 / 思考 / 权限从哪来

`dsh --profile acp` 的 `session/new` 只返回两个 `configOptions`：

| option | category | 取值 |
|---|---|---|
| `model` | `model` | 分组：`DeepSeek`、`DeepSeek Account`、`opencode-go`、`ChatGPT subscription`… |
| `reasoning_effort` | `thought_level` | `Provider default / Low / High / Max`（官方模型还有 `Off`） |

**没有 permission 选项。** 权限是 DSH 的会话权限预设：子进程启动时用 `DSH_PERMISSION_MODE` 传入（`src/acp-agent-service.mjs` 的 `ensure()`），预设存在 `~/.dsh/storages/no996_openfilm_project_permissions`，默认 `danger-full-access`。所以换模型不会、也不应该改变权限——权限是项目级，不是模型级。

排查"权限行变灰/消失"：先确认是 DSH 主界面菜单还是面板菜单；再看 `%TEMP%\dsh-openfilm\plugin.log` 的 `permission-hint-unavailable` / `acp-default-model-failed`。

## 6. 选择器纪律

- 只用稳定锚点：`data-*`、`role`、语义标签、`aria-*`、文本、结构关系；
- 禁止哈希类名与 `:nth-child` 深链；
- 新规则先最小作用域，不用 `*` 和全局 `!important`；
- 同一选择器出现第 3 个 `!important`，或开始依赖重渲染时机 → 升级为 A1。
