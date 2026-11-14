<!-- doc
id: playbooks-incident
reader: 值班的人、排查 bug 的人
fact-source: 真实故障记录（2026-11）、%TEMP%/dsh-openfilm/plugin.log、docs/architecture
checked: 0.15.3
rot-if: 出现新的故障类别，或某个根因被结构性消除
-->

# 流程：出事了

> 先给**证据等级**，再给结论。这个仓库历史上最贵的两个错误是"改对了代码但没到 Host"和"把症状当根因"。

## 1. 排查顺序（不要跳）

```text
1) 同一路由用 curl 打一次        → 请求到没到 Host？
2) 看页面 location.origin        → dsh-app:// 下相对 /api 是 404
3) 看 plugin.log 的最后 20 行     → 阶段、耗时、错误类别
4) 看 %TEMP%/dsh-openfilm-frames.jsonl → 一轮对话的真实分片
5) 重载插件（disable→enable）     → startedAt 必须变
6) 才去看代码
```

判据：**重载后 `plugin.log` 的 `startedAt` 更新**才算真的重载了。管理器返回 `restart-required` 时，如实告诉用户要重启，别声称已生效。

## 2. 故障档案

### 2026-11-14 · 对话全挂、模型只剩「默认」：路由 handler 里一个未声明的变量

**现象**：面板 `OpenFilm capability unavailable: agent:prompt — [503]
ACP_REQUEST_FAILED`；模型菜单只剩「默认」；`plugin.log` 每两秒一轮
`mcp-client(no996-openfilm): initial connection or tool synchronization failed`
→ `acp-session-failed` → `official-rpc-failed channel:"agent:models"`。

**根因**：MCP 端点的 handler 读了一个不存在的变量。控制器拆路由模块时，工厂的入参
叫 `isDisposed`，handler 里却写着 `if (disposed)`——每次请求都在 `res.setHeader`
之后抛 ReferenceError。Host 把这当成请求失败，回了 **400 空 body**，还带着我们刚设的
`cache-control: no-store`；ACP 子进程连不上端点，`session/new` 失败，于是模型、对话、
思考强度全没了。

**怎么一眼分辨**（这次靠这三条）：

| 路径 | GET 返回 | 含义 |
|---|---|---|
| 已注册的 exact 路由（`/bootstrap`） | 405 | handler 跑到了 |
| 没注册的路径 | 401 | 插件作用域守卫 |
| 我们的 MCP 路由 | **400 + `cache-control: no-store`** | handler 进得去、抛在了里面；`no-store` 是我们自己加的 |

**为什么先误判成"DSH 保留路径"**：当时 `/api/<plugin>/mcp` 看着像 DSH 的约定；换名后
400 依旧，才回去读 handler 源码。教训写在下面"反复出现的坑"里。

**改法**：`isDisposed()`；新增 `tests/chat-route.test.mjs` 直接调 handler，覆盖
405 / 503 / 200 / 500 四条路径；`mcp-self-check`（每次发凭据前 Host 自己 POST 一次
`initialize` 并记状态码）保留——这次就是它把 400 摆到台面上。

**边界**：只修了这一个 handler。其他拆分出去的 handler 是否有同类未声明变量，靠同样的
"真调一次"测试补。

### 2026-11-14 · 插件「启用失败」：Cannot access 'registerRoute' before initialization

**现象**：插件管理状态「异常」，红条 `1 entry did not activate dsh-openfilm`，
面板完全打不开。与 2026-11-12 那条 `trackRoute` 是同一个病的新位置。

**根因**：路由拆模块后，`createSystemRoutes({ register: registerRoute })` 排在
`const registerRoute = router.register;` 之前；同作用域先读后声明是 TDZ。

**为什么 CI 是绿的**：没有任何测试真的**调用** `createStudioController`——拆出去的
模块有测试，静态 `import` 只解析不执行函数体。

**改法**：`createRouter` 与三个绑定整体上移到第一个使用者之前；
`tests/declaration-order.test.mjs` 断言三个绑定紧挨着 router，且四个 `create*Routes({`
都在绑定之后。

**边界**：只钉住这一类（路由绑定）。其他"声明顺序"错误仍靠读代码发现。

### 2026-11-12 · 「本地服务」里的模型不能靠注入加

**现象**：给「设置 → 服务 → 本地服务」加 SenseVoice，先在 `assets/shell-ui.js` 里往弹窗 DOM 追加卡片。视觉上和原生的行不是一种东西，用户明确拒绝注入。

**根因**：这个弹窗属于 Studio（L2），不是桌面壳。上游源码（pin `758b1a3`）：

- 渲染：`packages/openfilm/studio/ui/src/components/settings/LocalModels.tsx`
- 元数据：`packages/openfilm/studio/server/local-models.mjs` 的 `ABOUT`
- 文件清单：`packages/openfilm/library/local-models.json`
- 下载源：`studio/server/library.mjs`，`OPENFILM_LIBRARY_URL`
- 缓存：`OPENFILM_LIBRARY_CACHE`，默认 `~/.openfilm/library`

UI 完全由 `/api/local-models` 的数据驱动，所以**不需要重建 Studio UI**：补 `ABOUT` + `local-models.json` 两处数据，行就按原生组件渲染。

**做法**：`src/studio-library-patch.mjs` 在 Host 启动时幂等改这两处（装在 `node_modules/openfilm`，pnpm 重装会覆盖）；`src/studio-library-mirror.mjs` 起回环镜像并把 `OPENFILM_LIBRARY_URL` 指过去。

**坑**：`npm run upstream:fetch` 用 `git fetch --depth=1 origin <sha>` 拉 pin commit 会报 `couldn't find remote ref`——对象其实在 clone 里，直接 `git -C .upstream/openfilm checkout --force <sha>`。另外 `openfilm` 的 `exports` 只开子路径，要 `import.meta.resolve('openfilm/package.json')` 再 `new URL('.', …)` 才拿得到包根。

---

### 2026-11-11 · 服务断线后点「重启」白屏

**现象**：长时间未使用后服务断开，点「重新启动工作台」白屏。

**根因（四条并存）**：

- 旧故障按钮跳到回环调试地址 `/editor`，那个入口只签发地址并重定向，不负责启动失联的 Studio；
- 旧 `running` 是内存 `ready` 位，上游失联也可能仍为真 → 改成受限的本地 `/api/health` 实际探测；
- 旧白屏检测只看首次启动，iframe 后续导航到错误页没有提示 → 导航重新计时，注入脚本在页面真正渲染后补发 `boot`；
- 桌面 `dsh-app://app` 的相对 `/api/...` 不到 Host，**不能把 404 当 Studio 断线**。

**边界**：模拟测试覆盖断开恢复、清理失败、并发、消息来源、导航超时；**真实 GUI 的断线恢复仍未验证**。

---

### 2026-11-12 · 删除项目报 500，弹出一整段 PowerShell

**现象**：官方壳项目列表点删除，红条里是 `Command failed: powershell.exe …`，文件夹还在。

**根因**：项目文件夹同时是它自己对话 Session 的工作目录，DSH 工作区监视持有目录句柄，Windows 拒绝把仍被监视的目录移进回收站；上游把整条命令和 stderr 原样塞进 500 的 `error`，壳的 fetch 包装又把 5xx 当可重试显示。

**改法**：代理在 `DELETE /api/projects/:id` 转发前先归档该项目的对话（`stopActivity`）释放监视；仍失败时把 `Command failed`/`powershell.exe` 一类 5xx 改写成 409 + 人话，避免壳重试和原始命令泄漏。

**边界**：409 只保证"不再出现原始命令"，不保证目录一定删得掉。

---

### 2026-11-12 · 项目对话总是掉进「未分组」

**现象**：每次打开项目，侧栏出现该项目的文件夹（工作区建对了），但对话留在「未分组」。

**根因**：两层形状假设错。`workspaceController.create({ path })` 返回 Remote 值 `{ workspace: { workspaceId, sessionIds, … }, created }`，代码只读 `created.id` / `created.workspaceId`，于是每次打开都报 `WORKSPACE_CREATE_NO_ID` 并退回 `{ cwd }` 建会话。工作区分组只认 `workspace.sessionIds`：`SessionSummary` 没有 `workspaceId`，`workspace/insertSessionBefore` 只移动已归组的会话，`attachSession` 不在契约里。

**改法**：解包 `created.workspace`（旧扁平形状兼容）；会话一律带 `workspaceId` 创建；建完回读 `sessionIds` 作为归组证据。存量空会话换新，有历史的不自动换绑，报 `WORKSPACE_SESSION_UNGROUPED`。

**边界**：非空旧会话没法归位（无 attach API）；Host 代码要重启 DSH 才生效。

## 3. 反复出现的坑（按主题）

| 主题 | 症状 | 现在的做法 |
|---|---|---|
| 顺序假设 | 严格顺序丢增量；反向把 unchanged 当流失效 | 按 index 去重，允许跳跃与接管 |
| 归因假设 | 只认 `user/message`，真实事件是 `agent/inbox/spliced` | 两种归因都认，只有 `kind:'user'` 且 rpcId 不匹配才算冲突 |
| 状态假设 | 绑定表不校验归档 → 每次发送 503；`running` 位不代表上游活着 | 发送前探针 + 健康检查 |
| 分组假设 | 把"会话属于哪个工作区"当会话字段 | 只认 `workspace.sessionIds` |
| 平台假设 | `dsh-app://` 下相对 `/api` 是 404 | 先看 `location.origin` |
| 重载假设 | 把"重启插件"当万能药，但请求没到 Host | 先 `curl` 同一路由 |
| 构建假设 | 手改 `vendor/official-shell/ui` 不重算 manifest | 启动即 `OFFICIAL_SHELL_UNAVAILABLE`，必须 `shell:bake` |
| 文档假设 | 测试数、文件数写死在多份文档里 | 数字不抄，能生成就生成 |
| 双实例 | profile 里同时有用户层与 bundle 条目，两个实例都 apply，第二个抛 "already registered"，整个插件 failed | 只留一个条目 |
| TDZ | 路由注册块写在 `const trackRoute` 之前 | `Cannot access 'trackRoute' before initialization`，apply 抛错 = 整个插件失败 |
| 拆分漏参 | 控制器拆成路由模块后，handler 读了作用域里已不存在的变量（`disposed` vs `isDisposed`） | 400 + 自己设的响应头；真调一次 handler 的测试才能抓到 |

## 4. 新增一条故障记录

写这四段就够，不要写流水账：**现象**（用户看到什么）、**根因**（可复核的机制）、**改法**（改了哪里）、**边界**（这次没解决什么）。
根因如果指向某个设计选择，去 `decisions/` 写/改 ADR，而不是留在本文。
