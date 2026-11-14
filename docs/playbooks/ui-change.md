<!-- doc
id: playbooks-ui-change
reader: 改界面的人、智能体
fact-source: docs/reference/ui-layers.md、src/theme.mjs、assets/theme/*.css
checked: 0.15.6
rot-if: 手段分级变化，或出现新的界面层
-->

# 流程：改一个界面

> 决策先于动手。**这块界面属于哪一层、该走哪一级手段**，先答完再看文件。
> 层的定义与 DOM 锚点见 [`../reference/ui-layers.md`](../reference/ui-layers.md)。

## 0. 先查这块界面在谁手里

改界面前先花半分钟确认源码在哪，**不要凭 npm 包里有什么去推断**：

| 要改的地方 | 源码路径（在 `.upstream/openfilm` 里） |
|---|---|
| 聊天列：项目列表、对话、登录、引导 | `apps/desktop/chat/src/` |
| 桌面壳：窗口布局、主题脚本、挂载 | `apps/desktop/shell/` |
| Studio 编辑器：画布、时间轴、素材库 | `packages/openfilm/studio/ui/src/` |
| 影片/模板页 | 本仓 `vendor/templates/` |

- **找得到** → 改源码：在 checkout 里改 → `pnpm --filter @openfilm/desktop build:shell` → `node scripts/build-official-shell.mjs .upstream/openfilm` → 新文件进 `patches/` 与构建白名单 → `npm run patches:check`。
- **找不到**（目前只有 DSH 外壳）→ 才考虑注入，并在 [`reference/injection-registry.md`](../reference/injection-registry.md) 登记理由与退出条件。

**经验（只写一次）**：这个仓库曾把"Studio 编辑器只能注入"当成事实写进文档，实际上游 `packages/openfilm/studio/ui/src` 一直是可改的源码，而且本来就参与我们的构建。教训是：**先看 checkout 目录，再决定手段**；判断错误会让一段本该进补丁的界面长期停在注入里。

> 移动 `.upstream/openfilm`（换路径、换盘）之后，`node_modules/.bin` 里的 pnpm 脚本硬编码了旧绝对路径，构建会报 `MODULE_NOT_FOUND`。在 checkout 里跑一次 `pnpm install --offline --force --config.confirm-modules-purge=false` 即可重建。

## 1. 决策表

| 你想改的 | 走哪级 | 落在哪 |
|---|---|---|
| 颜色、圆角、间距、字体 | token | `brand/brand.json` + `assets/theme/tokens.css` |
| L1 某个按钮/卡片的颜色、边框、阴影 | A2/B1 | `assets/theme/shell.css` |
| L2 编辑器里任何样式 | B1 | `assets/theme/studio.css` |
| L1 隐藏/移动/新增控件 | A1 | 上游源码 + `patches/` |
| L1 文案、i18n | A1 | 上游 `i18n/locales/*.ts` + 补丁 |
| 登录页、账号条、首次引导 | A1（结构）/ A2（样式） | 上游源码优先；现存注入见登记表 |
| 面板边框、加载态、侧栏图标 | L0 源码 | `src/studio-panel.mjs`、`src/studio-entry.js` |
| 影片画面、镜头、字幕 | L3 | `vendor/templates/*` + `npm run templates:build` |

**升级规则（硬约束）**

1. 同一选择器在注入层出现第 3 个 `!important`，或开始依赖上游重渲染时机 → 升级为 A1；
2. 需要新增 DOM 结构、监听事件、调用 Host 能力 → A1；A1 拿不到源码（L2）时才 B2，并登记退出条件；
3. 注入层不承载权限、凭据、业务写操作。

## 2. 标准流程

```text
定位元素 → 判断层 → 选级别 → 改文件 → 生效 → 验证 →（必要时）登记
```

1. **定位**：用 `dsh-element-source` 拿源码路径；拿不到（L1/L2 是构建产物）时用 47821 样式工作台点选，得到选择器 + 计算样式；
2. **判断层**：`dsh-app://` / DSH 端口 → L0；iframe 内 `/` → L1；`/projects/<id>` → L2；`/film/...` → L3；
3. **选级别**：按 §1；拿不准时默认 token，其次 A2/B1，最后才是 B2；
4. **改文件**：只改一个地方。token 不进 CSS，CSS 不写死颜色；
5. **生效**：见 §3；
6. **验证**：见 §5；
7. **登记**：没走源码的改动，在 [`../reference/injection-registry.md`](../reference/injection-registry.md) 留一行。

## 3. 生效方式

| 改了 | 怎么生效 | 代价 |
|---|---|---|
| `brand/brand.json`、`assets/theme/*.css` | 保存 + 刷新（读盘 + mtime） | iframe 重载，未保存编辑丢失 |
| `assets/shell-ui.js`、`shell-login.js` | 保存 + 刷新 | 同上；改注入清单要重载 Host |
| `src/studio-*.mjs`（Host） | 重载插件 + 刷新 | Studio 子进程重建 |
| `src/studio-entry.js` 等客户端源码 | `npm run build` + 刷新 | 同上 |
| 上游源码补丁 | `npm run shell:dev`（开发）/ `npm run shell:bake`（发布） | 首次要 checkout + 依赖 |
| `vendor/templates/**` | 下一次请求即生效 | 无 |

## 4. 样式工作台（开发）

`NO996_OPENFILM_STYLE_LAB=1` 启动 DSH，打开面板（或 47821 窗口），左下角出现「样式台」：

1. 点「点选元素」→ 点目标 → 显示选择器、标签、颜色/背景/字号/内边距、命中的 `--n996-*`；
2. 拖「强调色」「圆角」实时预览（只改当前页面变量）；
3. 点「复制说明」得到固定格式，直接粘给 agent：

```text
surface: shell | studio
selector: [data-...] > button
token: --n996-accent
before → after: #ff6400 → #d97706
层建议: token / shell.css / studio.css / 源码补丁
```

**工作台里的改动不持久化**：确认后写进 `brand/brand.json`（token）或 `assets/theme/*.css`，再刷新验证。

## 5. 验证

只做到"代码看起来对"不算完成：

1. `npm test` 通过（新增行为必须带测试）；
2. 目标页面刷新后能看到变化；样式类改动要能用 `NO996_OPENFILM_THEME=0` 回到原样；
3. 改 L1/L2 时检查原有控件没被遮挡/禁用，键盘焦点还在；
4. 交付说明写清证据等级：**真实 GUI 已验证** / **仅单测与源码验证**。后者要给出用户可执行的刷新步骤。

## 6. 反模式

- 用注入"修"上游布局 bug：上游一改类名就碎，而且没人知道它修过什么；
- 在注入里读 `localStorage` 业务状态、拼接口、发请求（那是 Host 的职责）；
- 为了一个颜色去改 React 源码（成本 2 GB，收益一条 CSS）；
- 把 `node_modules/openfilm` 当源码改（升级即覆盖，三处版本立刻不一致）；
- 手改 `vendor/official-shell/ui` 而不重算 manifest（启动即 `OFFICIAL_SHELL_UNAVAILABLE`）；
- 在 `client.js` 上改样式（下次 `npm run build` 就没了）。
