# AGENTS.md — dsh-openfilm / No996 Studio

给在本仓工作的智能体的操作手册。人读 [`README.md`](README.md)；架构与重载 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)；改界面 [`docs/UI-PLAYBOOK.md`](docs/UI-PLAYBOOK.md)；上游 [`docs/UPSTREAM.md`](docs/UPSTREAM.md)；品牌 [`docs/BRAND.md`](docs/BRAND.md)；架构 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)；路线 [`docs/ROADMAP.md`](docs/ROADMAP.md)；决策与故障 [`docs/NOTES.md`](docs/NOTES.md)。

> 被 `openfilm-video-editing` 预设的 `@deepseek-ai/dsh-agent-instructions` 读入（`maxBytes: 65536`）。细节写进 `docs/`，这里只留"不知道就会犯错"的部分。

---

## 0. 一句话

把官方 **OpenFilm 0.3.2** 工作台封装成可分发的 **DSH 插件**：Host 拉起官方 Studio 并反向代理，浏览器用 `shell.overlay` 常驻 iframe，官方对话由 Host 交给 `dsh --profile acp` 子进程（会话、模型、审批、思考、续聊都是 DSH 的）。当前 `0.13.3`（发布包 `0.12.1`）。仓库 `NewbieCheng/dsh-openfilm`，分支 `main`。

---

## 1. 红线（违反即回退）

1. **不碰用户既有项目和会话。** 模板安装只新建目录；不迁移、不删除、不改写别人的 `film.html`。
2. **自动化测试禁止真实模型调用。** 只用模拟对象与临时目录（`mkdtemp`）。
3. **只推 `NewbieCheng/dsh-openfilm`。** 不推 `不加班智能团-desktop`，也不改它的 `vendor/dsh`。
4. **未验证不得声称完成。** 只有在本机真实 GUI 里看到行为，才能说"好了"。
5. **不要把 `openfilm_draft` 当保存。** 它是纯内存草稿，不落盘、不渲染、不导出。
6. **不要把 Studio 代理当安全边界。** 它是本机回环集成，不是 OS 沙箱。

---

## 2. 三层界面，两种手段

| 层 | 页面 | 改法 |
|---|---|---|
| L0 DSH 外壳 | 侧边栏、面板边框、加载/错误态 | 我们的源码（`src/studio-*`），改完 build |
| L1 官方桌面壳 | 项目列表、对话、登录、引导 | 源码补丁（A1）或构建期/开发期 CSS（A2/B1） |
| L2 Studio 编辑器 | 时间轴、画布、素材库 | 只有 dist，没有源码 → 只能 CSS 注入（B1） |
| L3 影片/模板 | 用户项目里的 `film.html` | 改 `vendor/templates/*` 源 |

| 级别 | 手段 | 什么时候用 |
|---|---|---|
| **A1** | 上游源码补丁（`patches/`） | 结构、交互、文案、新增/删除控件 |
| **A2** | 构建期样式覆盖 | L1 的纯样式，且要随包发布 |
| **B1** | 样式注入（`assets/theme/*.css`） | L2 编辑器；L1 快速试色 |
| **B2** | DOM/行为注入（`assets/shell-ui.js`） | A1 做不到、又必须动 DOM，且已登记 |

**默认顺序：token → A2/B1 → A1 → B2。** 判断流程、注入登记表、反模式见 [`docs/UI-PLAYBOOK.md`](docs/UI-PLAYBOOK.md)。收到 `dsh-element-source` 的「[元素定位]」时：先读源码、展示代码、一句话说明渲染内容，然后**停下等修改需求**。

---

## 3. 仓库地图

| 层 | 位置 |
|---|---|
| Host | `index.js`、`cordis.patch.yml`、`src/studio-controller.mjs` |
| 运行时/代理 | `src/studio-runtime.mjs`、`src/studio-proxy.mjs`、`src/official-shell.mjs` |
| 对话桥 | `src/acp-*.mjs`、`mcp-server.mjs`、`project-instructions.mjs`（ACP）+ `official-chat-*`、`official-event-*`、`official-facade.mjs`、`official-permission.mjs` |
| 影片工具 | `src/film-*`、`draft-*`、`timeline-*`、`*-tool.mjs` |
| 模板/动效 | `vendor/templates/**`、`vendor/motion/**` |
| 界面注入 | `src/shell-extras.mjs` + `assets/shell-ui.js` / `shell-login.js` / `login-city.js` |
| 主题/品牌 | `src/theme.mjs`、`assets/theme/*.css`、`brand/brand.json`、`src/brand.mjs` |
| 样式工作台 | `src/style-lab.mjs` + `assets/style-lab.js`（`NO996_OPENFILM_STYLE_LAB=1`） |
| 上游快照 | `vendor/official-shell/{manifest.json,ui,source,patch.diff}` + `patches/`（我们的补丁，放在快照外） |
| 客户端 | `src/studio-entry.js`、`studio-panel.mjs`、`panel-keepalive.mjs` → `client.js`（禁止手改） |

---

## 4. 改一行的最短路径

```sh
npm run build                      # 只在改了客户端源码时需要
npm run templates:build            # 改了 _kit 或 shots/*.json 后
npm run motion:index               # 改 catalog 后重生成 STYLES/SHOT-CARDS
npm run frame:studio -- motion-styles 2   # 抽模板帧（临时 home）
npm run onboard:preview            # 打桩 RPC 看首次启动向导
npm run dev:styles                 # watch 主题文件
npm run docs:check && npm run brand:check
npm run upstream:status && npm run patches:check
node --test tests/*.test.mjs       # 全库（数量以输出为准，不抄）
```

顺序：**判断层 → 改源 → build（如需）→ 测试 → 生效 → 真机确认。** 跳过测试直接进 GUI 是最常见的返工来源。

---

## 5. 生效矩阵

| 改了 | 构建 | 生效 | 代价 |
|---|---|---|---|
| `brand/brand.json`、`assets/theme/*.css` | 否 | 保存 + 刷新（读盘 + mtime） | iframe 重载，未保存编辑丢失 |
| `assets/shell-ui.js` / `login-city.js` / `shell-login.js` | 否 | 保存 + 刷新 | 同上；改注入清单要重载 Host |
| 客户端源码 | **是** | 刷新 | 同上 |
| Host 源码 `index.js`、`src/*.mjs` | 否 | 重载插件 + 刷新 | Studio 子进程重建 |
| `vendor/templates/**` | 否 | 下一次请求即生效 | 无 |
| `vendor/official-shell/ui/**` | 是（上游） | 部署产物后重启 Studio | 清单不匹配 → `OFFICIAL_SHELL_UNAVAILABLE` |
| `cordis.patch.yml` | 否 | 重新 `install_bundle` 或重启 Host | 已有会话不迁移 |

**重载前先 `touch index.js src/*.mjs`**：加载器只重新求值 mtime 变了的模块，未 touch 的引入方会继续用旧 import——症状是"改了没生效"。`npm run dev` 会替你 touch。

**本插件不是热加载的。** 管理器返回 `restart-required` 时如实报告并按 `nextStep` 重启；新 `host-start` 只证明 Host 重建。

---

## 6. 端口与环境变量

| 项 | 值 |
|---|---|
| Studio 上游 | `startStudio({port:0})` 临时端口，仅 Host 可见 |
| 编辑器代理 | `http://<web host>:47822`（`NO996_OPENFILM_EDITOR_PORT`） |
| 调试/样式窗口 | `http://127.0.0.1:47821`（`NO996_OPENFILM_DEBUG_PORT`，`0`=关） |
| DSH Web 源 | 必须是 `http://127.0.0.1:<port>`，否则控制器抛错 |

| 变量 | 作用 |
|---|---|
| `NO996_OPENFILM_DSH_CHAT=1` | 退回"官方 Studio + 内嵌 DSH 对话列" |
| `NO996_OPENFILM_DEV=1` | 开发者模式：跳过账号门，不产生 token |
| `NO996_OPENFILM_THEME=0` | 关闭所有主题注入 |
| `NO996_OPENFILM_STYLE_LAB=1` | 注入样式工作台（点选元素 + 复制说明） |
| `NO996_OPENFILM_DEV_SHELL=1` | 用 `.dev/shell` 代替正式壳（仅开发） |
| `NO996_UPSTREAM_DIR` | 上游 checkout 位置（默认 `.upstream/openfilm`） |

**桌面页面来源是 `dsh-app://app`，不是 http**：相对 `/api/...` 会 404；`frame-ancestors` 必须列 `dsh-app:`/`app:` 与回环端口，否则静默白屏。

---

## 7. 证据入口

`POST /api/no996-openfilm/diagnose {projectId}`（面板静默 20 秒后自动贴出）；`%TEMP%\dsh-openfilm\plugin.log`（JSON Lines，自动脱敏）；`%TEMP%\dsh-openfilm-frames.jsonl`（每轮覆盖）；`%TEMP%\dsh-openfilm-preset.json`；`%TEMP%\dsh-openfilm-host.json`（重载后 `startedAt` 必须更新）。

**不要靠猜形状**：ACP 的字段以 `fake-acp-agent.mjs` 或真机日志为准；旧路径已不是主线。

---

## 8. 测试与提交

- `node --test tests/*.test.mjs`；只用 mock 与 `mkdtemp`，`OPENFILM_HOME` 指临时目录。
- 新增行为必须带测试；本仓历史 bug 大多是"逻辑没问题但顺序/形状假设错"。
- 改上游界面时，`tests/kernel-shell-match.test.mjs` 的断言与补丁一起更新。
- ESM，无 TypeScript；Host 模块保持 `createX(deps)`，不在顶层做 IO；注释写"为什么"。
- 提交信息：`类型: 结论 版本号`，例 `fix: 首条消息 503 OUTCOME_UNKNOWN 与项目被永久锁死 0.3.1`。

---

## 9. 当前未完成（别写进"已完成"）

账号余额与引流卡收口；官方壳 O1/O2、素材入库、O3；ACP 面板真机验收（`docs/TEST-CHECKLIST.md` 第 11 步）与之后删旧路径（`docs/ARCHITECTURE.md §10`）；官方输入框部分场景只读；字体子集化；技能卡；口播转写 Mac 验收。详见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

---

## 10. 不要做

- 不要手改 `client.js`（会被 build 覆盖）。
- 不要给 `openfilm_draft` 加"保存/导出"；`project-core.mjs` 不要接到 UI 或工具上当授权边界。
- 不要升级 `openfilm` 而不同步 `vendor/official-shell` 与 `OFFICIAL_COMMIT`（三处一起动）。
- 不要在浏览器侧接受任意 URL 当编辑器来源。
- 不要声称预览、导出、渲染已接通——没接通。
- 不要在注入层承载权限、凭据、业务写操作。
- 不要把"已实现"的计划文档留在 `docs/`；已完成的删，未完成的并进 `ROADMAP`。
