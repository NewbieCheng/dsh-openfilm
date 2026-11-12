# 决策与故障档案

> 只记"为什么这么定"和"真实发生过的故障"。已发布的改动看 [`../CHANGELOG.md`](../CHANGELOG.md)；操作手册看 [`../AGENTS.md`](../AGENTS.md) 与 [`DEVELOPMENT.md`](DEVELOPMENT.md)。

---

## 1. 关键决策

| # | 决定 | 理由 | 代价 / 约束 |
|---|---|---|---|
| D1 | 独立仓分发，不做工作台分支 | 需要可分发的边界（`files` 白名单 + bundle patch + client 声明） | 两边代码不共享；`vendor/film-doc.mjs` 只能是副本 |
| D2 | 面板挂 `shell.overlay`，`main` 只放占位 | `main` 切页即卸载，iframe 会整页重载、丢编辑状态 | 自己同步矩形（resize + 轮询） |
| D3 | 默认用官方桌面壳，DSH 对话列作回退 | 用户要"官方工作台完整保留"，不是近似界面 | 壳是构建产物，改动要走补丁 + manifest |
| D4 | 浏览器只看到代理端口，Studio key 不出 Host | key 进浏览器 = 任何页面脚本都能操作 Studio | WS 帧要改写 Origin、拦 URL 里的 key/ticket |
| D5 | 固定端口 47822 / 47821 | 给用户一个可手输的稳定地址 | 端口冲突直接失败；调试台是额外攻击面 |
| D6 | 模板复制"独占创建 + 失败不删" | 一旦 `openProject` 可能已提交，删除可能删掉已注册项目 | 失败后要用户确认，不能自动重试 |
| D7 | 对话失败分"已归因/未归因" | 未归因自动重发可能重复执行；永久锁死又会卡住用户 | 未归因要人工确认 |
| D8 | 增量按 index 去重，允许跳跃与接管 | 严格顺序会丢实时增量，用户看不到思考和回复 | 不能反向把"正常 unchanged"当流失效 |
| D9 | 先埋帧记录，再改翻译层 | 事件 bug 全是"真实分片名与假设不符" | 每轮写 `frames.jsonl`，文本截断 |
| D10 | 实验代码不接主线 | 协作锁不是原子 CAS，Node FS 不是 DSH 沙箱 | `project-core.mjs`、`client-entry.js` 保持未注册 |
| D11 | 归档走 DSH 自己的集合 | 自建一份必然与侧边栏分叉 | `workspaceController` 缺席时只能报不可用 |
| D12 | 归档项目再发消息：明确拒绝 + 两个按钮 | 自动取消/换绑会改写用户会话身份 | 多一次点击 |
| D13 | 工具卡片：名称 + 参数摘要 + 结果首 500 字 | 只显示名称等于没显示；全文可能含私有路径 | 长结果不可全文阅读 |

### 2026-11 新增

| # | 决定 | 理由 |
|---|---|---|
| D14 | 样式走"一份 CSS，两种消费"（开发注入 / 发版烘焙） | 纯样式不值得为"改源码"装 2 GB 依赖；但也不能永远挂在运行时 |
| D15 | 上游补丁按文件拆系列 | 升级时冲突要落在具体文件，而不是 80 KB diff 的行号 |
| D16 | 品牌是数据（`brand/brand.json`），不是常量 | 换名字不能靠全局搜索；归属声明必须跟品牌一起走 |

---

## 2. 故障档案

### 2026-11-11：服务断线后点"重启"白屏

**现象**：长时间未使用后服务断开，点「重新启动工作台」白屏。

**代码层发现**：

- 旧故障按钮跳到回环调试地址 `/editor`，那个入口只签发地址并重定向，不负责启动失联的 Studio。
- 旧 `running` 是内存 `ready` 位，上游失联也可能仍为真。现在用受限的本地 `/api/health` 实际探测；失败后保留清理句柄，后续启动先清旧代理/实例再重建。
- 旧白屏检测只看首次启动；iframe 后续导航到错误页没有提示。现在导航重新计时，注入脚本在页面真正渲染后补发 `boot`。
- 桌面 `dsh-app://app` 的相对 `/api/...` 不到 Host，不能把 404 当 Studio 断线。
- 日志只记状态/阶段/耗时/错误类别，不写上游原始异常、票据、密钥、完整凭证 URL 或项目路径。

**边界**：模拟测试覆盖了断开恢复、清理失败、并发、消息来源、导航超时；**真实 GUI 的断线恢复仍未完成验证**。重载时管理器返回 `restart-required`，同时日志出现新 `host-start`/`studio-warm`——只能证明 Host 重建，不能推断全部变更已应用。

### 2026-11-12：删除项目报 500，弹出一整段 PowerShell

**现象**：官方壳项目列表点删除，红条里是 `Command failed: powershell.exe …`，连点几次都一样，文件夹还在。

**根因**：项目文件夹同时是它自己对话 Session 的工作目录（DSH 工作区），工作区文件监视持有目录句柄，Windows 拒绝把仍被监视的目录移进回收站；上游把整条命令和 stderr 原样塞进 500 的 `error`，壳的 fetch 包装又把 5xx 当可重试错误显示。

**改法**：代理在 `DELETE /api/projects/:id` 转发前先归档该项目的对话（`stopActivity`），释放监视；仍失败时把 `Command failed`/`powershell.exe` 一类 5xx 改写成 409 + 人话，避免壳重试和原始命令泄漏。

**边界**：`409` 只保证"不再出现原始命令"，不保证目录一定删得掉——目录被别的进程占用时仍需先关掉占用方。真实 GUI 删除未复测。

### 2026-11-12：项目对话总是掉进「未分组」

**现象**：每次打开视频创作区的项目，侧栏都会出现该项目的文件夹（工作区建对了），但对话不在文件夹下面，而是留在「未分组」里一条「新会话」。

**根因**：两层形状假设错。`workspaceController.create({ path })` 在 DSH 0.11 返回 Remote 值 `{ workspace: { workspaceId, sessionIds, … }, created }`，代码只读 `created.id` / `created.workspaceId`，于是每次打开都报 `WORKSPACE_CREATE_NO_ID` 并退回 `{ cwd }` 建会话。工作区分组只认 `workspace.sessionIds`：`SessionSummary` 没有 `workspaceId`，`workspace/insertSessionBefore` 只移动已在组里的会话（"Move one accounted Session"），`attachSession` 根本不在契约里。cwd 建出来的会话永远进不了组。

**改法**：解包 `created.workspace`（旧扁平形状继续兼容）；会话一律带 `workspaceId` 创建；建完再 `create({ path })` 回读 `sessionIds` 作为归组证据。存量里空会话换一条归组的新会话（旧的不删、不改名），有历史的不自动换绑，只报 `WORKSPACE_SESSION_UNGROUPED`。

**边界**：非空的旧会话没法归位（没有 attach API），只能留在未分组；Host 代码要重启 DSH 才生效（插件管理器返回 `restart-required`）。

### 反复出现的坑（按主题）

- **顺序假设**：严格顺序丢增量；反向把 unchanged 当流失效。→ 按 index 去重，允许跳跃。
- **归因假设**：只认 `user/message`，真实事件是 `agent/inbox/spliced`；注入的 AGENTS 块带 `source.kind:'agent-instructions'`，不是人。→ 两种归因都认，只有 `kind:'user'` 且 rpcId 不匹配才算冲突。
- **状态假设**：绑定表不校验归档 → 每次发送 503；`running` 位不代表上游活着。→ 发送前探针 + 健康检查。
- **分组假设**：把"会话属于哪个工作区"当成会话自身字段。→ 只认 `workspace.sessionIds`；`SessionSummary` 没有 `workspaceId`，`attachSession` 不存在。
- **平台假设**：只在 http 语境设计前端。`dsh-app://app` 下相对 `/api` 是 404，`frame-ancestors` 不列 `dsh-app:` 会静默白屏。
- **重载假设**：把"重启插件"当万能药；请求根本没到 Host。→ 先 `curl` 同一路由 + 看页面 `location.origin`。
- **构建假设**：手改 `vendor/official-shell/ui` 不重算 manifest → 启动即 `OFFICIAL_SHELL_UNAVAILABLE`。
- **文档假设**：测试数量、文件清单写死在多份文档里，几版之后全对不上。→ 数字不抄，链接靠 `docs:check`。
- **日志字段**：`path`/`session`/`cookie` 会被脱敏成 `[redacted]`；写日志换名字（`route`/`authed`）。

---

## 3. 五条不变的规矩

1. 不碰用户既有项目和会话。
2. 测试不调真模型。
3. 只推本仓。
4. 未验证不说完成。
5. 安全边界不靠"看起来有"：代理不是沙箱，草稿不是保存，实验代码不接主线。
