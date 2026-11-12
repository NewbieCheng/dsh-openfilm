# UI 改造手册（改哪一层、怎么改、怎么验证）

> 这份文档回答一个问题：**这个界面改动应该写在哪里？**
> 最短操作约束看 [`../AGENTS.md`](../AGENTS.md)；上游同步看 [`UPSTREAM.md`](UPSTREAM.md)；品牌替换看 [`BRAND.md`](BRAND.md)。

---

## 1. 四层界面

| 层 | 页面 | 源码归属 | 我们能不能改源码 |
|---|---|---|---|
| L0 DSH 外壳 | 侧边栏、面板边框、加载/错误态 | 本仓 `src/studio-entry.js`、`studio-panel.mjs` | 能，完全自己的 |
| L1 官方桌面壳 | 项目列表、对话、登录、首次引导 | 上游 `apps/desktop/*`，产物在 `vendor/official-shell/ui` | 能，但要走源码补丁 + 重建 |
| L2 Studio 编辑器 | 时间轴、画布、素材库 | 上游 npm 包，只有 `studio/ui/dist`，**没有源码** | 不能，只能样式注入 |
| L3 影片/模板页 | 用户项目里的 `film.html` | 本仓 `vendor/templates/*` | 能，改模板源并重建 |

判断顺序：**先看页面 URL 和它属于哪一层，再决定手段。** 把 iframe 里的按钮当成 DSH Slot、把影片内容当成工作台 UI，是这里最常见的错误。

---

## 2. 两种手段，四级落点

手段只有两种：**改源码** 和 **注入**。但"改源码"分两级，因为纯样式不该为了"政治正确"去装 2 GB 依赖。

| 级别 | 手段 | 适用 | 生效 |
|---|---|---|---|
| **A1** | 上游源码补丁（TS/React） | 结构、交互、文案、新增组件、删除控件 | 重建壳 → 刷新 |
| **A2** | 构建期样式覆盖（CSS 进产物） | L1 的纯样式，且要随包发布 | 重建/打包 → 刷新 |
| **B1** | 样式注入（同一份 CSS，开发期注入） | L2 编辑器；L1 的快速试色 | 保存 + 刷新 |
| **B2** | DOM/行为注入（`assets/shell-ui.js`） | 只有 A1 做不到、又必须动 DOM 时 | 保存 + 刷新 |

**关键约定：A2 和 B1 是同一份文件。** `assets/theme/shell.css` 在开发期由代理注入，发版前 `npm run shell:bake` 把它（含 `tokens.css` 与品牌变量）烘焙进 `vendor/official-shell/ui`：加一个 `<link>`、写一个 `no996-theme.css`、重算 manifest。所以"样式注入"不是永久债，只是同一份源码的两种消费方式。

---

## 3. 决策表

| 你想改的 | 走哪级 | 落在哪 |
|---|---|---|
| 颜色、圆角、间距、字体 | token | `brand/brand.json` + `assets/theme/tokens.css` |
| L1 某个按钮/卡片的颜色、边框、阴影 | A2/B1 | `assets/theme/shell.css` |
| L2 编辑器里任何样式 | B1 | `assets/theme/studio.css` |
| L1 隐藏/移动/新增控件 | A1 | 上游源码 + `patches/` |
| L1 文案、i18n | A1 | 上游 `i18n/locales/*.ts` + 补丁 |
| 登录页、账号条、首次引导 | A1（结构）/ A2（样式） | 上游源码优先；现状部分在 `assets/shell-login.js`，见 §6 登记表 |
| 面板边框、加载态、侧栏图标 | L0 源码 | `src/studio-panel.mjs`、`src/studio-entry.js` |
| 影片画面、镜头、字幕 | L3 | `vendor/templates/*` + `npm run templates:build` |

**升级规则（硬约束）：**

1. 同一选择器在注入层出现第 3 个 `!important`，或开始依赖上游重渲染时机 → 升级为 A1。
2. 需要新增 DOM 结构、监听事件、调用 Host 能力 → A1；A1 拿不到源码（L2）时才能 B2，并登记退出条件。
3. 注入层不允许承载权限、凭据、业务写操作。它只做展示和转发到既有 RPC。

---

## 4. 标准流程

```text
定位元素 → 判断层 → 选级别 → 改文件 → 生效 → 验证 → （必要时）登记
```

1. **定位**：用 `dsh-element-source` 拿到源码路径/行号；拿不到（L1/L2 是构建产物）时，用 47821 样式工作台点选，得到选择器 + 计算样式。
2. **判断层**：URL 是 `dsh-app://` / DSH 端口 → L0；iframe 内 `/` → L1；`/projects/<id>` → L2；`/film/...` → L3。
3. **选级别**：按 §3 决策表；拿不准时默认 token，其次 A2/B1，最后才是 B2。
4. **改文件**：只改一个地方。token 不进 CSS，CSS 不写死颜色。
5. **生效**：见下表。
6. **验证**：至少做到"改前/改后各看一眼"，并在交付说明里写清"真实 GUI 已验证 / 仅测试验证"。

### 生效方式

| 改了 | 怎么生效 | 代价 |
|---|---|---|
| `brand/brand.json`、`assets/theme/*.css` | 保存 + 刷新页面（读盘 + mtime 缓存） | iframe 重载，未保存编辑丢失 |
| `assets/shell-ui.js`、`assets/shell-login.js` | 保存 + 刷新页面 | 同上 |
| `src/studio-*.mjs`（Host） | 重载插件 + 刷新 | Studio 子进程重建 |
| `src/studio-entry.js` 等客户端源码 | `npm run build` + 刷新 | 同上 |
| 上游源码补丁 | `npm run shell:dev`（开发）或 `shell:pack`（发布） | 首次要 checkout + 依赖 |
| `vendor/templates/**` | 下一次请求即生效 | 无 |

### 样式工作台（开发）

`NO996_OPENFILM_STYLE_LAB=1` 启动 DSH，打开面板（或 47821 窗口），左下角出现「样式台」：

1. 点「点选元素」→ 在页面里点目标 → 显示选择器、标签、颜色/背景/字号/内边距、命中的 `--n996-*`。
2. 拖「强调色」「圆角」实时预览（只改当前页面的 CSS 变量）。
3. 点「复制说明」→ 固定格式，直接粘给 agent：

```text
surface: shell | studio
selector: [data-...] > button
token: --n996-accent
before → after: #ff6400 → #d97706
层建议: token / shell.css / studio.css / 源码补丁
```

Esc 退出点选。**工作台里的改动不会持久化**：确认后写进 `brand/brand.json`（token）或 `assets/theme/*.css`（覆盖），再刷新验证。

---

## 5. 样式文件与 token

```text
brand/brand.json          ← 产品名、颜色、链接、上游归属（唯一事实来源）
assets/theme/tokens.css   ← 非品牌 token：圆角、间距、动效曲线
assets/theme/shell.css    ← L1 覆盖
assets/theme/studio.css   ← L2 覆盖
src/theme.mjs             ← 读取 + 注入（按 surface 注册表）
```

- 品牌色由 `brand.json` 生成 `--n996-*` 变量，注入在 tokens 之前。
- 新增一个界面：在 `src/theme.mjs` 的 `THEME_SURFACES` 加一行，建一个 CSS 文件，不需要改代理。
- 关断开关：`NO996_OPENFILM_THEME=0` 启动 DSH，所有注入样式消失。用来判断"是不是主题导致的"。
- 注入失败（文件缺失、样式里出现 `</style>`）时整块不注入，页面照常工作——样式永远不能把应用弄白。

### 选择器纪律

- 只用稳定锚点：`[data-*]`、`[role]`、语义标签、稳定的 `aria-*`。
- 禁止依赖 Vite 生成的哈希类名（`._abc123`）和 `:nth-child` 深链。
- 新规则先写最小作用域，再考虑放宽；不要用 `*` 和全局 `!important`。

---

## 6. 注入登记表

每一处"没走源码"的改动都要在这里留一行。没有登记 = 不允许合入。

| 注入 | 文件 | 为什么不是源码 | 退出条件 |
|---|---|---|---|
| 模板选择弹窗 | `assets/shell-ui.js` | 历史上先做的注入；上游有模板入口 | 模板主路径迁进 A1 后删除 |
| 视频工具环境检查卡 | `assets/shell-ui.js` | 需要 Host 能力，上游没有这个界面 | 上游有环境检查或迁进 A1 |
| 账号条 / 登录态 | `assets/shell-ui.js` | 上游没有我们的账号体系 | 账号体系进 A1 的壳 |
| 全屏登录首页 | `assets/shell-login.js` | 上游登录页不适用 | 同上 |
| 故障卡片 / 恢复卡 | `assets/shell-ui.js` | 上游没有错误 UI | 上游有错误边界后删除 |
| 主题 token + 覆盖 | `assets/theme/*.css` | L2 无源码；L1 走 A2 同一份文件 | L2 拿到源码后转 A1/A2 |

登记内容只需要三件事：**为什么不能改源码、现在怎么工作、什么条件下撤掉。**

### 隐藏行（B2，最小面积）

侧栏本身必须是官方 `WorkspaceBrowser`：接管 `sidebar.workspaces`（`priority: -100` 确实能盖过官方条目，单槽规则也成立）会连文件夹按钮、间距、菜单一起重画，0.13.0 试过，观感对不上，已撤。现在只做一件事：

| 注入 | 位置 | 为什么 | 退出条件 |
|---|---|---|---|
| 项目对话行隐藏 | `src/area-hider.mjs`（样式表注入） | DSH 没有按会话隐藏的 API，但官方行自带 `data-row-key="session:<id>"`，一条 `display:none` 就能只藏这几行，其余照旧原生渲染 | DSH 提供按会话隐藏时删除 |

失败面：DSH 改掉 `data-row-key` 就不再隐藏（不会错藏别的行，因为选择器带完整前缀和会话 id）。宿主拿不到列表（桌面页、路由未挂）时不隐藏，宁可露出也不猜。

项目页不在侧栏：它是 `main` 槽的一个面板（key `no996-openfilm-projects`），从 `sidebar.panellist` 进入，列表/搜索都在那儿。真机排错顺序：`plugin.log` 有 `area-route mounted` → 页面刷新过（客户端 bundle 变了）→ 侧栏里项目对话消失（隐藏生效）→ 图标栏多一个「项目」→ 点行后中间区切到视频创作。

---

## 7. 反模式

- 用注入"修"上游的布局 bug：上游一改类名就碎，而且没人知道它曾经修过什么。
- 在注入里读 `localStorage` 里的业务状态、拼接口、发请求：那是 Host 的职责。
- 为了一个颜色去改 React 源码：成本 2 GB，收益一条 CSS。
- 把 `node_modules/openfilm` 当源码改：升级即覆盖，且三处版本会立刻不一致。
- 手改 `vendor/official-shell/ui` 而不重算 manifest：启动直接 `OFFICIAL_SHELL_UNAVAILABLE`。
- 在 `client.js` 上改样式：下次 `npm run build` 就没了。

---

## 8. 验证

只做到"代码看起来对"不算完成。至少：

1. `node --test tests/*.test.mjs` 通过（新增行为必须带测试）。
2. 目标页面刷新后能看到变化；`NO996_OPENFILM_THEME=0` 能回到原样（样式类改动）。
3. 改的是 L1/L2 时，同时检查原有控件没被遮挡/禁用，键盘焦点还在。
4. 交付说明里写清证据等级：**真实 GUI 已验证** / **仅单测与源码验证**。后者要给出用户可执行的刷新步骤。

---

## 9. 与其它文档的关系

- `AGENTS.md` §2.1 是给 agent 的最短判断规则；本文是完整版。
- `UPSTREAM.md` 管补丁怎么重放、升级怎么不丢改动。
- `BRAND.md` 管品牌替换的边界与法务。
- `TEMPLATES.md` 管 L3（影片/模板）的构建。
