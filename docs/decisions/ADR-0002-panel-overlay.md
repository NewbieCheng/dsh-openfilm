<!-- doc
id: ADR-0002-panel-overlay
reader: 维护者、改界面的人
fact-source: src/studio-entry.js、src/studio-panel.mjs、src/panel-keepalive.mjs
checked: 0.15.6
rot-if: DSH 提供"常驻页面"官方能力，或面板改为独立窗口
-->

# ADR-0002：面板挂 `shell.overlay` 常驻，`main` 只放占位

- 状态：生效
- 日期：2026-10

## 背景

视频面板是 iframe，里面是官方 Studio。DSH 的 `main` 槽按"当前选中的侧栏入口"渲染，**切走即卸载**——iframe 卸载会丢掉未保存的编辑、重载整页、断开 Studio 会话。

## 决定

- `sidebar.panellist` 只提供入口；
- 真正的 iframe 挂在 `shell.overlay`（不随切换卸载），`main` 里只留占位；
- 显示/隐藏由 `src/panel-keepalive.mjs` 控制；矩形靠 resize + 轮询同步（没有官方"矩形变化"事件）。

## 代价

- 自己维护可见性与矩形，DSH 改外壳布局就要跟着调锚点；
- 面板"常驻"意味着 Studio 子进程常驻，崩溃恢复要自己做（健康探针 + 清理句柄）；
- 固定端口 47822/47821 给了用户稳定地址，但也意味着端口冲突直接失败、调试台多一个攻击面。

## 证据

`src/studio-entry.js` 的 `main`/`shell.overlay` 注册；`src/panel-keepalive.mjs`；`tests/` 中面板常驻断言。
