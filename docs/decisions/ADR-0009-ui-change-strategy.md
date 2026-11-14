<!-- doc
id: adr-0009
reader: 改界面的人、决定"改哪一层"的人
fact-source: scripts/build-official-shell.mjs、patches/series.json、.upstream/openfilm、docs/reference/injection-registry.md
checked: 0.15.4
rot-if: 上游不再发布 studio/ui 源码、构建白名单变化、任何注入转成补丁或被撤掉
-->

# ADR-0009：界面改动先改源码，注入只是例外

## 1. 背景

界面有两块：**DSH 外壳**（侧栏、面板边框）和 **OpenFilm 本身的界面**（聊天列 + Studio 编辑器）。
以前为了快，用了不少"运行期注入"：往页面里塞一段 JS/CSS，改 DOM、改样式。

用户的目标很明确：

1. 一个文件夹里做完所有事，不再在几个 checkout 之间跳；
2. 能改官方源码就改源码，跟上游合并（而不是长期靠注入补丁）；
3. 注入带来的闪屏、选择器脆弱、性能损耗，能去掉就去掉。

这份 ADR 回答：**哪些能改源码、哪些不能、先改哪些**。

## 2. 事实（不是设想）

先说一个容易搞错的前提——本仓库看到的 OpenFilm 界面，**本来就是我们自己构建的**：

| 事实 | 依据 |
|---|---|
| 上游完整源码就在仓里：`.upstream/openfilm`，HEAD `758b1a3`（= 钉住的 0.3.2），1.3 GB，带 node_modules，已 gitignore | `du`、`git -C .upstream/openfilm rev-parse HEAD` |
| 这份 checkout 里有我们的 **21 个改动**，就是 `patches/series.json` 的来源 | `git status` 21 files |
| 桌面壳一次构建同时打进了 **Studio 编辑器**和**聊天列** | `apps/desktop/shell/main.tsx` 里 `App` 来自 `openfilm/studio-ui/App.tsx`，`mountChat` 来自 `apps/desktop/chat/src` |
| 构建脚本允许改 `apps/desktop/chat/src/**` 与 `packages/openfilm/studio/ui/src/**`，其它改动一律拒绝 | `scripts/build-official-shell.mjs` 的 `PATCHED` 白名单 |
| 我们自己构建的 `vendor/official-shell/ui` 会作为 `editorDir` 交给 Studio，**顶替** npm 包里的 `studio/ui/dist` | `startStudio({ editorDir })` + `src/studio-controller.mjs` 的 `resolveEditorDir` |

L2 的界面结构因此和 L1 一样能改源码：npm 包只发布 dist，上游 monorepo 有源码。

真正改不了源码的只有一处：**DSH 外壳**——它不是本仓库的代码，我们只能用它的插槽，或用窄注入。

## 3. 决策

| 手段 | 什么时候用 | 今天的状态 |
|---|---|---|
| **A1 源码补丁** | 默认。上游源码里存在的界面（L1 聊天列、L2 编辑器、L3 模板） | 已有 21 个补丁 + 构建白名单 |
| **A2 构建期样式** | 纯配色/间距，且上游有变量或稳定类名 | 与 A1 同一个构建 |
| **B1 样式注入** | 临时试色；或某个样式必须按运行时条件切换 | `assets/theme/*.css` |
| **B2 DOM 注入** | 只剩一种情况：**DSH 外壳没有对应插槽** | `src/sidebar-editing.mjs` |

**规则：**

1. 新的界面需求，先问"上游源码里有没有这块"，有就做补丁，不做注入；
2. 每处注入必须在 `reference/injection-registry.md` 登记（为什么不能改源码、退出条件），没登记不许合入；
3. 能进 `.upstream/` 的改动都进那里——**不再在仓库外开新的 checkout**。

## 4. 优先级：先迁哪几处注入

判断口径三条，缺一条都不做：**用户体验真的变好**（闪屏/错位/交互被抢）、**上游合并成本可控**（改动面小、能逐文件重放）、**有验证办法**（真机看得见）。

| # | 注入 | 层 | 为什么现在难用 | 改成源码的代价 | 建议优先级 |
|---|---|---|---|---|---|
| U1 | 模板选择弹窗 | L1 聊天列 | 选择器一改就静默失效；弹窗层级与官方弹层打架 | 中：`ProjectStarters` 已在补丁里，扩一处 | **P0** |
| U3 | 账号条 / 登录态 | L1 聊天列 | 每次重渲染都要 re-inject，闪烁 | 中：`shell-ui.js` 里那一段搬进 `chat/src`，Host 只管接口 | **P0** |
| U5 | 故障卡片 / 恢复卡 | L1 聊天列 | 上游重渲染后卡片消失（"报错了但看不到"） | 小：一个条件组件 | **P0** |
| U2 | 视频工具环境检查卡 | L1 聊天列 | 同上，且依赖 Host 接口返回时序 | 中：需要一个 Host 读接口（已有） | P1 |
| U4 | 全屏登录首页 | L1 壳 | 注入出来的整页，首屏白一下 | 大：要进壳的路由/首屏分支 | P1 |
| U6 | 主题 token + 覆盖 | L1 + L2 | 首帧闪主题色；每次 iframe 重载重新注入 | **小**：构建时 import 一份 CSS | P1 |
| U7 | 侧栏工作区开关 | **L0 DSH** | 唯一合理的一条：没有可改的源码 | 不可改；等 DSH 开槽位就撤 | 保持，不迁 |

**为什么 U1/U3/U5 排最前**：它们都是"上游一重渲染就可能消失"的东西，坏了用户看到的是功能消失而不是样式不对——这是本仓历史上重复踩过的坑。三条加起来改动面仍小，能一批做完、一批验。

**为什么 U6 值得早做**：代价最小（构建里多一行 import），收益是首帧不闪。但如果和 U1/U3/U5 抢时间，U6 往后放——它坏不了功能，只难看。

**为什么 U4 不着急**：登录页是独立整页，注入白一下但之后稳定；改成壳内路由要动首屏逻辑，风险大于收益，等前面几条稳了再做。

## 5. 上游合并（这才是选源码的代价）

选了源码，就必须接受"每次升上游要重放补丁"。流程固定：

1. `npm run upstream:status` 看三处 pin 是否同版本；
2. `npm run upstream:fetch` 把 `.upstream/openfilm` 拉到新 commit（**会丢掉本地改动，先确认 21 个补丁都已在 `patches/` 里**）；
3. `npm run upstream:verify` 重放补丁，冲突按文件报告，不整树失败；
4. 在 checkout 里手工解冲突 → 重新构建 `vendor/official-shell`（快照 + `patch.diff`）；
5. `npm run patches:check && npm run check`；
6. **过一遍注入登记表**：这次上游改动有没有让某条注入的退出条件成立；
7. 真机：登录 → 引导 → 开项目 → 发一句 → 删项目。

第 2 步是唯一危险动作：`.upstream` 不是备份，**补丁文件才是**。

## 6. 一个文件夹的布局

```text
dsh-openfilm/              ← 只开这一个
  .upstream/openfilm/      ← 上游源码（含我们的 21 处改动 + node_modules），gitignore
  vendor/official-shell/   ← 我们构建出的壳（产物，进 git，供发布）
  patches/                 ← 补丁系列（源头，可重放）
  films/                   ← 本机影片库，gitignore
  src/ assets/ docs/ …
```

规则：上游相关的东西都在 `.upstream/`，产物在 `vendor/`，用户数据在 `films/`。三者都不在 git 里（或按规则进 git），`git status` 永远只反映我们自己的源码改动。

## 7. 后果

**好**：没有运行期 DOM 抢渲染，闪屏与"重渲染就消失"的 bug 消失；上游升级时冲突是显式的（按文件）；样式与结构走同一次构建，性能与首屏可控。

**坏**：每次升上游要重放补丁并重建快照（1.3 GB checkout 也要维护）；补丁数量会随界面需求增长，`patches:check` 之外还需要人判断"这处该不该进补丁"。

**不做**：

- 不改 DSH 本体源码（不是我们的仓库，升级会覆盖）；
- 不 fork 整个 Studio 另起产品（除非上游停更）；
- 不在注入层做权限、凭据、业务写操作（红线不变）。

## 8. 白话版

给非工程背景的人看的版本（含批次、你会看到什么变化、验收方法）在
[`topics/ui-plan.md`](../topics/ui-plan.md)。两篇讲的是同一件事，一份给决策，一份给执行。
