<!-- doc
id: injection-registry
reader: 改界面的人、reviewer
fact-source: assets/shell-ui.js、assets/shell-login.js、assets/theme/*.css、src/sidebar-editing.mjs
checked: 0.15.1
rot-if: 新增/撤掉任何一处没走源码的改动
-->

# 注入登记表

> 每一处"没走源码"的改动都要在这里留一行。**没有登记 = 不允许合入。**
> 迁移顺序与判断口径（为什么源码优先、先迁哪几条）见 [ADR-0009](../decisions/ADR-0009-ui-change-strategy.md) §4。
> 登记只要三件事：为什么不能改源码、现在怎么工作、什么条件下撤掉。

## 1. 登记表

| 注入 | 文件 | 为什么不是源码 | 退出条件 |
|---|---|---|---|
| 模板选择弹窗 | `assets/shell-ui.js` | 历史上先做的注入；上游有模板入口 | 模板主路径迁进 A1 后删除 |
| 视频工具环境检查卡 | `assets/shell-ui.js` | 需要 Host 能力，上游没有这个界面 | 上游有环境检查或迁进 A1 |
| 全屏登录首页 | `assets/shell-login.js` | 上游登录页不适用 | 迁成壳的首屏分支 |
| 工作区下拉开关 | `src/sidebar-editing.mjs` | 侧栏标题行没有官方插槽；`sidebar.workspaces` 是 single 槽 | DSH 开出标题行插槽后删除 |

## 1.1 已经不在注入里的（别再加回来）

| 东西 | 现在在哪 |
|---|---|
| 账号条 / 登录态 | `packages/openfilm/studio/ui/src/components/WorkbenchAccount.tsx`（React 源码，补丁） |
| 故障恢复卡（工作台已停止运行） | `apps/desktop/shell/RecoveryGate.tsx`（React 源码，补丁；2026-11 从 `assets/shell-ui.js` 迁出） |
| 主题 token + 覆盖 | 发布产物在构建期由 `npm run shell:bake` 烘进 `vendor/official-shell/ui/assets/no996-theme.css`；运行时那份只是开发热更 |
| 视频工具环境检查卡 | 仍是注入，见上表 |

## 2. 侧栏那一处为什么是"窄注入"

`sidebar.workspaces` 是 **single** 槽：一个优先级一个注册，最小者独占渲染，且官方浏览器组件未导出。占用它等于重写整块界面——置顶、归档、运行中、右键菜单、拖拽都会丢，2026-11 真机试过并撤回（见 ADR-0006）。

现行做法（`src/sidebar-editing.mjs`）：

1. 文本 + 结构锚点找到「工作区/会话」`span`，**只隐藏它并插入切换按钮**；
2. 选「剪辑区」时隐藏它的兄弟列表、显示我们的列表，头部只留搜索（视图选项移进文件夹行的 ⋯）；
3. 按钮占 header 固定槽（`data-no996-switch-host` + `--n996-switch-w`），搜索展开永远在剩余宽度里；
4. 删除项目走 `POST /api/no996-openfilm/editing-delete-project`，前端不直接删文件。

**不占 single 槽、不加行级按钮、不往会话菜单/视图菜单加条目。**

回归保护：`tests/sidebar-untouched.test.mjs` 在源码里出现 `sidebar.workspaces` 注册、`viewOptionsMenu`、`data-row-key`、`contextMenus` 等字样时失败，并单独断言这处开关只碰标题、不碰列表行。

## 3. 注入层的硬约束

- 不承载权限、凭据、业务写操作；只做展示与转发到既有 RPC；
- 所有节点带 `data-no996-*` 标记，一次性可摘除；
- 样式注入失败必须整块跳过，不能把应用弄白；
- 关断开关：`NO996_OPENFILM_THEME=0`（样式）、侧栏开关的源码级开关（注入逻辑本身）。

## 4. 撤销一处注入时

1. 删代码 + 删登记行 + 更新对应测试；
2. 在 `CHANGELOG.md` 记一行"撤销某注入"；
3. 如果它曾是某个 bug 的临时修法，去 `playbooks/incident.md` 补一句"根因已消除"。
