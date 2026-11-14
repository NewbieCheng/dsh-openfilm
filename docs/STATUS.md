<!-- doc
id: status
reader: 所有人（"现在到哪了"）
fact-source: package.json 的 version、CHANGELOG.md、git log、TEST-CHECKLIST 的待验项
checked: 0.15.1
rot-if: 每次发版、每个批次结束、任何"待验"变"已验证"
-->

# 状态

> **唯一允许写"进度"的地方**（另两个是 `ROADMAP.md` 与 `CHANGELOG.md`）。
> 版本号不手写：`npm run status:check` 会拿 `package.json` 核对本文件。

## 1. 版本

| 项 | 值 |
|---|---|
| 仓库版本 | **0.15.1**（`package.json`） |
| 最近发布包 | 0.12.1（据 `AGENTS.md`；发版前在 Releases 页核对一次） |
| 运行基线 | DSH 0.15.x、Node ≥ 22.8 |

## 2. 这一批做完了什么（0.15.1）

- 剪辑区：搜索、删除对话/清空对话/删除项目（回收站 + realpath 与 `.film` 校验）、静默刷新。
- 视觉收口：内联 SVG 图标、圆点选中态、菜单/弹窗/toast 入场动效，`prefers-reduced-motion` 关闭。
- 工程：CI、零依赖 lint、`npm test`/`npm run check` 入口、`dist/` 二进制出库。
- 文档：本文件与 `docs/index.md`、`decisions/`、`reference/`、`playbooks/` 落地（ADR-0007）。
- 结构：代理/控制器抽出 6 个模块，路由注册表已迁 4 条（system×3、client-log），余 10 条见 ADR-0008。

## 3. 进行中

无。下一批见 [`ROADMAP.md`](ROADMAP.md)。

## 4. 待真机验证（源码完成 ≠ 可以用）

| 项 | 证据等级 | 怎么验 |
|---|---|---|
| ACP 面板：刷新页面后发一句 → 侧栏同一会话 | 源码 + 离线集成通过 | [`TEST-CHECKLIST.md`](TEST-CHECKLIST.md) 第 11 步 |
| 删除项目：壳里删 → 进回收站 → 恢复 | 单测通过 | 手动删一个空项目再恢复 |
| 登录 → 剪辑 → 退出 → 再进免登 | 单测 + 离线 | 第 2 步 |
| 首次引导 O1/O2 | 源码完成 | 第 4 步 |
| 账号余额展示 | 未实现 | — |

## 5. 已知边界（不是 bug）

- 官方输入框在部分场景只读；默认权限不是完全访问。
- 预览/渲染沙箱未接；`openfilm_draft` 只是内存草稿。
- macOS/Linux 未做真机验收（仓库只在 Windows 验证过）。
- 侧栏「工作区」标题行的所有改动都是窄注入（见 `reference/injection-registry.md`）。

## 6. 怎么更新这篇

发版或批次结束时手改 §1/§2/§3；§4 只增不减，除非有真机证据；§5 变了先改 `reference/safety.md` 再改这里。
