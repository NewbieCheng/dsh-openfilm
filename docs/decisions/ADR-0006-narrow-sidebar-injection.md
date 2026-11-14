<!-- doc
id: ADR-0006-narrow-sidebar-injection
reader: 维护者、改界面的人
fact-source: src/sidebar-editing.mjs、tests/sidebar-untouched.test.mjs
checked: 0.15.5
rot-if: DSH 为侧栏标题行开出官方插槽
-->

# ADR-0006：侧栏只做一处窄注入，不占 single 槽

- 状态：生效
- 日期：2026-11

## 背景

需要在侧栏加"剪辑区"入口。`sidebar.workspaces` 是 **single** 槽（一个优先级一个注册，最小者独占渲染），且官方浏览器组件未导出。2026-11 真机试过占用它：置顶、归档、运行中状态、右键菜单、拖拽全部丢失，已撤回。

## 决定

- **不占** `sidebar.workspaces`，也不往会话行/会话菜单加业务项（菜单已有固定习惯，加业务项会冲突）；
- 只做一处窄注入：找文本为「工作区 / 会话」、父节点同时含搜索框与两个以上按钮的 `span`，只隐藏它并插入切换按钮；选「剪辑区」时隐藏它的兄弟列表、显示我们的列表，头部只留搜索；
- 注入节点全部带 `data-no996-*` 标记，可一键关闭；`tests/sidebar-untouched.test.mjs` 在源码出现 `sidebar.workspaces` 注册、`viewOptionsMenu`、`contextMenus` 等字样时失败。

## 代价

- 依赖 DSH 侧栏 DOM 结构：标题文字、层级、按钮数量任何一个变了都可能错位；
- 每次 DSH 升级都要把这条注入放进回归清单（`playbooks/verify.md`）；
- 视觉改动要自己对齐官方（图标线宽、动效时长、圆点选中态）。

## 证据

`src/sidebar-editing.mjs`、`reference/injection-registry.md` 的登记行、`tests/sidebar-untouched.test.mjs`。
