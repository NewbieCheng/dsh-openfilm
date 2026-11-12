## 0.9.0

### 新
- **工具调用显示真名**：`已检查影片 · openfilm_film`、`搜索网页「获客运营」· web_search`，不再只有闭集文案。
- **对话内联图片**：抽的帧、出的联系表直接画在对话里（最大高 420px，点击放大），走 `GET /api/no996-openfilm/attachment?id=<64hex>`，只读附件库、64 位 hex 校验、DSH 浏览器同源。
- **逐轮诊断**：`/api/no996-openfilm/diagnose` 按项目回最近 4 轮的帧计数、产出更新数、被丢弃的帧，并给判词 —— `no-frames-received`（DSH 没产出）/ `nothing-emitted`（我们丢帧）/ `some-frames-dropped` / `emitted`；同时带 `grouping`（会话是否真的在项目文件夹下）。

### 改
- 没有文本的思考块**不再建行**（以前留一个空的「思考 0s」）。
- 底部按钮只显示「模型 · 思考强度」：`自动（按这一句话的内容）` 的长括号被剥掉，模型名不再被挤成 `D…`。

### 修
- **调工具不再弹出独立的剪辑浏览器窗口**：原因是 `openfilm_cli` 启动内核 CLI 时没设 `OPENFILM_NO_BROWSER=1`，而 CLI 的 `look`/`render` 在项目缺 `.film/opened` 时会 `open(project)` —— 那正是"启动 Studio 并在人的浏览器里打开"，窗口里还带着上游桌面端引流。修法三层：固定 `OPENFILM_NO_BROWSER=1`；绑定项目时由 Host 写 `.film/opened` 标记；`openfilm_cli` 只保留 `doctor`（`look`/`render` 按名字拒绝，指向 `openfilm_frame`/`openfilm_export`）。
- **会话不再掉进「未分组」**：`workspaceController` 缺失、`create` 抛错、`attachSession` 不存在或失败，四处 `catch` 原来全静默，失败即退回 `cwd` 分支。现在每步记 `workspace-join {step, ok, code}`；建完用 `sessionController.list()` 复验 `workspaceId`，不成立才 attach、再复验，**最多重试一次**；两次仍不成立标记 `degraded` 但项目照常打开；已存在的会话每次打开都会重新 seat，之前漏挂的会自己归位。

### 文档
- 新增 `docs/HANDOVER.md`（接手第一站：五分钟上手、五条红线、当前状态、三类故障先查哪里）、`docs/ROADMAP.md`（一份路线图，不再按版本碎片化；0.9.1 定为账号与登录）。
- 重写 `docs/DEVELOPMENT.md`（25KB → 14KB，事实更新到 0.9.0）。
- 删除 10 份已实现的过期计划文档（PLAN-0.4.0 / 0.5.0 / 0.7.0-AGENT / DESIGN-0.7.0 / AGENT-CHAT-PLAN / PLAN-0.8.0 ×2 / PLAN-0.9.0 ×2 / DISCUSS-0.10.0），决策历史仍在 `docs/NOTES.md`。

### 验证
- `node --test tests/*.test.mjs` → **358 项 / 357 通过 / 1 跳过 / 0 失败**。
- 上游 `pnpm --filter "@openfilm/desktop" exec tsc -p chat` → exit 0。
- 界面快照补丁 **15 → 17 个文件**（新增 `packages/shared/src/markdown-blocks.ts`、`apps/desktop/chat/src/components/Markdown.tsx`），`vendor/official-shell/patch.diff` 与 `manifest.patch.files` 一致。

### 升级提示
Host 侧改动需要**重启 DSH**；界面刷新用 Ctrl+Shift+R 即可。旧会话的归属会在下次打开项目时自愈。
