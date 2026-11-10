# 交接文档（给下一个 DSH 会话）

> 写于 2026-11-10。下一个会话请**在 `F:/Dev/Desktop-Projects/dsh-openfilm` 这个目录新建工作区/会话**，不要用 `不加班智能团-desktop`（那是工作台主仓，本插件只是它的历史分支，已明确不作为交付物）。

## 一句话目标

把 OpenFilm 官方视频工作台封装成**独立可分发的 DSH 插件**：官方 Studio + 官方右侧对话完整保留，DSH 模型/Agent 作后端；提供 `openfilm-video-editing` 专属 Agent 预设；三个内置模板；能通过对话真实编辑项目。

## 仓库与发布状态

- 仓库：`F:/Dev/Desktop-Projects/dsh-openfilm`，远程 `NewbieCheng/dsh-openfilm`，分支 `main`
- 最新提交：`3b277e4`（0.3.4），此前 `e4efab4`(0.3.3) `5e397bc`(0.3.1) `8259ad0`(0.2.4) `cdc67ff` `384a1ac` `dd39cee`(0.2.0 首个）
- **只推这个仓，绝不推工作台仓**（`dsh-openfilm-plugin` 分支仅作历史）
- 测试：`node --test tests/*.test.mjs`，当前 **96 通过 / 1 跳过**（跳过项需 `DSH_PINNED_SOURCE` 指向只读 DSH 源码）
- 构建：`npm run build`（esbuild 出 `client.js`）；`node_modules` 里只有 esbuild/openfilm/zod，无锁文件

## 关键文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 插件入口（`inject` + `apply`） |
| `cordis.patch.yml` | 插入 `dsh-openfilm` 插件行 + `preset-openfilm-video-editing` 预设行 |
| `src/studio-controller.mjs` | 路由 `/api/no996-openfilm/{bootstrap,diagnose,templates,debug-url}`、`/no996-openfilm/{standalone,templates}` |
| `src/official-agent-service.mjs` | DSH 会话编排：建会话、follow 流、prompt/取消、终态、错误分类、帧记录 |
| `src/official-agent-events.mjs` | 流帧 → 官方 ACP 事件翻译（**当前主要 bug 所在**） |
| `src/official-facade.mjs` | 浏览器侧桥：`localAgents.*`、SSE、`chat.load/save` |
| `src/official-chat-rpc.mjs` / `official-approvals.mjs` | 官方对话 RPC 与审批 |
| `src/template-bridge.mjs` | `POST /api/no996-openfilm/templates`（鉴权+白名单+1KiB 限制） |
| `src/official-templates.mjs` | 模板列举/复制/官方 `openProject` 注册 |
| `src/studio-panel.mjs` | 面板 UI（模板首页、iframe、预设状态行） |
| `src/studio-entry.js` | 客户端入口：注册 `main`(占位) / `sidebar.panellist`(图标) / `shell.overlay`(常驻面板) |
| `src/panel-keepalive.mjs` | 面板常驻：切页不卸载 iframe |
| `src/openfilm-prompt.mjs` | 预设 scoped prompt |
| `src/preset-report.mjs` | 启动时把预设激活状态写 `%TEMP%\dsh-openfilm-preset.json` |
| `vendor/templates/*` | 三个内置模板（paper-texture 纸纹讲堂 / replica-film 复刻影片 / sketchnote 手绘笔记） |

## 已证实（有证据）

- 三个模板经官方 `openfilm/film-doc` 解析通过；复制 → 官方 `openProject` 注册 → `.film/` 生成 → **跨进程持久化**
- 预设行被 Loader 接受；插件客户端在真实 GUI 里注册成功（`sidebar.panellist` 与 `main` 均 active；面板现挂在 `shell.overlay` 常驻）
- 面板常驻改造完成：切页不再重载 Studio
- 对话：发送前等事件流就绪、增量与终态同通道有序、取消不伪造完成、失败只暴露安全分类、未归因失败可重试、已归因失败才锁定、发送不覆盖用户选的模型

## 当前未解决（按优先级）

1. **思考有状态但无内容**（用户截图：`正在思考 0s` 空白）。真实分片类型名与我假设的 `reasoning-delta` 不符。
2. **工具调用完全不显示**：`tool_call` / `tool_call_update` 未翻译。
3. **右侧输入框只读**：能力协商/Capability 位不全。
4. **权限非默认完全访问**：`SessionCreateRequest` 只有 `workspaceId/cwd/sessionId/agentPreset`，无权限字段，需要在建会话后用会话级接口设置。
5. **预设卡片仍显示「加载失败」**：已修 `tool-fs-search` 缺 `sampleOverCapGlobResults`，但仍未通过激活；`preset-report` 里 `broken` 字段随版本时有时无，需现场确认。
6. **模板拆素材 + 首页改造**（用户新需求，未开工）：三模板拆成可检索/可组装素材单元并重组等价；首页直进对话（不再选模板）；「内置模板」移到对话区下拉；隐藏首页「视频复刻」入口。

## 诊断工具（下一步先做这个）

**0.3.4 已加帧记录**：每轮发送结束后写 `%TEMP%\dsh-openfilm-frames.jsonl`（覆盖、文本截断 200 字符）。

> 下一步第一步：让用户发一条消息 → 读这个文件 → 按**真实**分片类型名重写 `official-agent-events.mjs`（思考/正文/工具三样一起对齐）。不要再凭形状猜。

预设状态：`%TEMP%\dsh-openfilm-preset.json`（`registered/ok/detail/raw/presets`）。

## 安装与重载

```
plugin_manager remove_bundle  target=dsh-openfilm
plugin_manager install_bundle target=F:/Dev/Desktop-Projects/dsh-openfilm
plugin_manager set_plugin enabled=false/true target=include:no996-openfilm   # 旧工作台插件（应保持停用）
```

装完需要用户刷新页面。当前 profile 已装 0.3.4，旧插件 `@no996/dsh-openfilm` 已停用。

## 硬约束

- 不碰用户既有项目/会话；模板安装只新建目录
- 自动化测试只用模拟与临时目录，**禁止真实模型调用**
- 不改 `不加班智能团-desktop` 与其 `vendor/dsh`（只读参考）
- 安全：503 只回错误码 + 固定词表；模板桥拒绝非浏览器 peer、非本机 Host/Origin、非 JSON、>1KiB
- 未验证的能力不得声称已完成（用户对"报漂亮但没验证"极度敏感）

## 踩过的坑（别再重复）

- `OFFICIAL_AGENT_OUTCOME_UNKNOWN`：曾把"未归因失败"永久锁项目 → 现改为可重试
- 新会话无模型导致首条消息必失败 → 建会话后一次性采用宿主默认模型
- 严格顺序规则丢弃实时增量 → 改为按 index 去重、允许中途接管、允许跳跃
- 又反向踩坑：把"正常 unchanged"当成流失效 → 已修（0.3.3）
- 预设 `tool-fs-search` 缺必填 `sampleOverCapGlobResults` 导致整预设 invalid config
- 子智能体连续两次整体失败（任务粒度过大）→ 下一步拆成单点任务，逐个验证
