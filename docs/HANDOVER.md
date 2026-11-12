# 交接说明（给接手的智能体 / 开发者）

> 你拿到的是一个**能跑、有测试、有真机验收记录**的 DSH 插件。先花十分钟读这一页，再去读别的。

## 一、五分钟上手

1. 读 [DEVELOPMENT.md](DEVELOPMENT.md) 的 §1（图）和 §4（模块表）——先建立"哪块在哪"的印象。
2. 跑一次 `node --test tests/*.test.mjs`（应看到 358 项 / 357 通过 / 1 跳过）。跑不起来说明环境没装依赖：`npm install`。
3. 跑一次 `npm run build`，确认 `client.js` 能重新生成。
4. 打开 [ROADMAP.md](ROADMAP.md)：**下一个任务在 0.9.1 的账号与登录**，那里写了动手前必须先查清的四件事。

## 二、这个仓的五条红线

1. **不要手改 `client.js`**（`npm run build` 的产物）。
2. **不要删除用户的 DSH Session**，也不要动上游 `.film/`。`rebind` 只新建空会话，旧的原样留着。
3. **上游快照恰好 17 个文件带本地改动**（`vendor/official-shell/patch.diff`）。改界面 = 改 `F:\Dev\_upstream\openfilm` 源码 → `build:shell` → `node scripts/build-official-shell.mjs <checkout>`。运行时注入 DOM 不算方案。
4. **浏览器可触达的路由**（`/api/no996-openfilm/*`、`/__dsh/*`）必须：只收本机 DSH 浏览器同源（`ctx.connection.admit`）、字段白名单、体积上限、错误只回固定码。
5. **`openfilm_cli` 只留 `doctor`**。`look` / `render` 会启动 Studio，而内核会在项目缺 `.film/opened` 时**在人的浏览器里弹一个剪辑窗口**。看画面用 `openfilm_frame`，导出用 `openfilm_export`。

## 三、改完怎么生效（别浪费时间重启）

| 改动 | 生效方式 |
|---|---|
| `assets/shell-ui.js`、`vendor/official-shell/ui/**` | 刷新页面（Ctrl+Shift+R） |
| 客户端源码 | `npm run build` + 刷新 |
| Host 源码（`index.js`、`src/*.mjs`） | 重启 DSH（或重载插件）+ 刷新 |
| 上游界面源码 | `build:shell` + 快照脚本 + 重启 DSH |

## 四、当前状态（0.9.0，已发布）

已经做完并且有测试/验收的：

- 官方界面整页进面板；对话走 DSH 会话（文本、思考、工具、计划、审批）；
- 右侧面板显示**工具真名**、**对话内联图片**（抽帧的图直接画出来）、思考块（空的不画）、底部只显示「模型 · 思考强度」；
- 一个项目 = 一个会话，落在以项目命名的 Workspace 文件夹里（有复验与降级标记）；
- 调工具不再弹独立剪辑窗口（`OPENFILM_NO_BROWSER=1` + `.film/opened` 标记 + CLI 收窄）；
- 诊断能回答"面板为什么是空的"（`turns[].verdict`）与"会话在不在项目文件夹下"（`grouping`）。

待做与已定不急的都在 [ROADMAP.md](ROADMAP.md)。0.9.0 已提交并发版（`dsh-openfilm-0.9.0.tgz`）；写这份文档时工作树是干净的，没有未提交的半成品。

## 五、怎么确认"改对了"

1. 单测：`node --test tests/*.test.mjs`（不需要浏览器、不调真实模型）。
2. 上游类型：`pnpm --filter "@openfilm/desktop" exec tsc -p chat`（在 `F:\Dev\_upstream\openfilm`）。
3. 快照一致：`node -e "const m=require('./vendor/official-shell/manifest.json')…"` 检查 `patch.files` 都在 `patch.diff` 里（`tests/kernel-shell-match.test.mjs` 也查）。
4. 真机：[TEST-CHECKLIST.md](TEST-CHECKLIST.md)。**单测绿不等于真机对**——历史上有三次"测试全绿、真机空白"。

## 六、最常见的三类故障，先查这三个

| 症状 | 先看 |
|---|---|
| 面板空白 / 只显示"正在思考" | `POST /api/no996-openfilm/diagnose {projectId}` → `turns[].verdict`（`no-frames-received` = DSH 没产出；`nothing-emitted` = 我们丢帧） |
| 红条 `[503] PROJECT_CONVERSATION_CREATE` | 预设没装起来：`agentPresets.list()` 里 `openfilm-video-editing` 的 `ok/error`；多半是 `cordis.patch.yml` 又挂了宿主已挂的插件 |
| 会话跑到「未分组」 | diagnose 的 `grouping`（`degraded` = 没能证明归属）；`plugin.log` 里 `workspace-join` 的 `step/code` |

日志与帧文件位置见 [DEVELOPMENT.md](DEVELOPMENT.md) §9。

## 七、需要产品决定的两件事（不要自己拍）

1. **登录的语义**（0.9.1）：是把上游 Studio 的账号登录搬进面板，还是让 DSH 的账号成为唯一账号、上游额度只做只读展示？两种做法的接口和存储完全不同。
2. **项目文件夹显示名**：`手绘笔记-9e6b7c5847a2` 这种带随机后缀的，显示名要不要截短（真实路径不动）。
