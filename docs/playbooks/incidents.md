<!-- doc
id: playbooks-incidents
reader: 接手排障的人、智能体
fact-source: src/studio-controller.mjs、src/studio-controller/routes/chat.mjs、tests/declaration-order.test.mjs、tests/mcp-endpoint-path.test.mjs
checked: 0.15.2
rot-if: 这几条防护被删掉，或换了 Host 加载方式
-->

# 故障账

每一条都是真机上坏过一次的。写的是**症状 → 根因 → 为什么当时没抓到 → 现在靠什么挡住**，
不是复盘文章。新故障按同样格式往下加。

## 1. 插件「启用失败」：Cannot access 'registerRoute' before initialization

**症状**：插件管理里状态「异常」，顶部红条 `dsh warning: 1 entry did not activate
dsh-openfilm (dsh-openfilm): ReferenceError: Cannot access 'registerRoute' before
initialization`，视频面板完全打不开。

**根因**：路由拆成模块后，`createSystemRoutes({ register: registerRoute })` 被排在
`const registerRoute = router.register;` 之前。同一函数作用域内先读后声明是 TDZ，
入口在 activate 阶段就抛错。

**为什么没抓到**：本仓没有测试真的**调用** `createStudioController`——`bootstrap-route`、
`editing-routes` 测的都是拆出去的模块；静态 `import` 只解析不执行函数体。CI 全绿。

**现在靠什么挡住**：`tests/declaration-order.test.mjs` 断言三个路由绑定必须在
`createRouter(` 之后紧挨着，且 `createSystemRoutes`/`createAssetRoutes`/
`createDiagnosticsRoutes`/`createChatRoutes` 必须在这三个绑定之后。

## 2. 对话全挂、模型列表空：MCP 端点占了 DSH 的保留路径

**症状**：面板里 `OpenFilm capability unavailable: agent:prompt — [503]
ACP_REQUEST_FAILED`；模型菜单只剩「默认」；`plugin.log` 每 2 秒一轮：

```
acp-ready → acp-request-failed code:-32603
data:{"details":"mcp-client(no996-openfilm): initial connection or tool synchronization failed"}
→ acp-session-failed → acp-model-fallback → official-rpc-failed channel:"agent:models"
```

**根因**：我们的 MCP 端点注册在 `/api/no996-openfilm/mcp`。**DSH 保留所有
`/api/<plugin>/mcp`** 给插件清单里声明的 MCP 服务；不是那个用途时，Host 在路由之前
就用 400 回掉，我们的 handler 一次都没被调用。ACP 子进程连不上端点 → `session/new`
失败 → 模型、对话、思考强度全都没有。旧版本能用是运气：那时没有这层保留判断。

**怎么一眼认出来**（不用读 DSH 源码）：

| 路径 | 返回 | 含义 |
|---|---|---|
| `/api/no996-openfilm/bootstrap`（已注册的 exact 路由） | 405（GET） | 我们的 handler 跑到了 |
| `/api/no996-openfilm/mcp-session`（没注册的路径） | 401 | 插件作用域守卫：路径不认识 |
| `/api/no996-openfilm/mcp`（保留路径） | **400，空 body** | DSH 自己接走了，不是我们的代码 |

**现在靠什么挡住**：

- 端点改到 `/api/no996-openfilm/mcp-host`，并在 `routes/chat.mjs` 顶部写明保留规则；
- `tests/mcp-endpoint-path.test.mjs`：路径不能是 `/mcp`，交给子进程的 URL 必须和
  路由声明的一致；
- `mcp-self-check`：每次给子进程发凭据前，Host 自己先 POST 一次 `initialize`，把
  **实际状态码**写进 `plugin.log`。下次再出问题，日志里直接有 `status: 400`，不用猜。

## 3. 界面"刷一下就不见了"：运行时注入被上游重渲染冲掉

**症状**：模板弹窗、环境卡在切项目/重渲染后消失，或者和官方弹层抢层级。

**根因**：注入的节点是挂在 React root 外面的手工 DOM，上游一重渲染就把它冲掉；
克隆官方卡片的做法还要用 MutationObserver 一直跟着重贴。

**现在靠什么挡住**：见 [ADR-0009](../decisions/ADR-0009-ui-change-strategy.md) 与
[playbooks/ui-change.md](ui-change.md)。默认改源码（A1），注入是例外且必须登记在
[injection-registry](../reference/injection-registry.md)。
