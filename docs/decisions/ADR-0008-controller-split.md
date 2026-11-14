<!-- doc
id: ADR-0008-controller-split
reader: 维护者、要动 controller/proxy 的人
fact-source: src/studio-controller.mjs、src/studio-proxy.mjs、tests/*.mjs
checked: 0.15.1
rot-if: 拆分完成或策略改变
-->

# ADR-0008：两个巨型闭包按职责拆开，分两步走

- 状态：生效（两步均已落地；14 条路由已迁 12 条，余 2 条）
- 日期：2026-11-14

## 背景

`src/studio-controller.mjs`（1,522 行）和 `src/studio-proxy.mjs`（853 行）各是一个巨型闭包：路由、鉴权、诊断、代理、协议解析全在一个函数作用域里。改一处要在上千行里找上下文，review 时也看不出边界。

但也不能直接砍：有 **6 个测试是读源码文本的**，它们把"注册顺序/路径必须出现/不许出现某些符号"当成契约：

| 测试 | 断言对象 |
|---|---|
| `tests/declaration-order.test.mjs` | 路由注册块必须在 `registerRoute` 之后（TDZ） |
| `tests/route-registration-order.test.mjs` | 注册顺序与路径清单 |
| `tests/system-routes.test.mjs` | `system/check`、`system/install` 路径出现在 controller |
| `tests/dev-mode.test.mjs`、`tests/first-run-wizard.test.mjs` | 特定字符串仍在 controller |
| `tests/sidebar-untouched.test.mjs` | controller 里不出现 `sidebar.workspaces` 注册等 |

所以拆分会同时改变测试的"事实来源"，必须一起迁。

## 决定

**第一步（已做，0 行为变化）**：只把不依赖闭包状态的助手搬出去。

| 新模块 | 内容 |
|---|---|
| `src/studio-proxy/websocket.mjs` | `WS_GUID`、`MAX_FRAME`、`wsFrame`、`frames` |
| `src/studio-proxy/upstream.mjs` | 失败日志、`COMMAND_FAILURE` 与人性化改写、头白名单、`upstreamOrigin/listen/shutdown/ancestorsFor/fail` |
| `src/studio-controller/http-body.mjs` | `readJsonBody`（体积上限 + 形状归一） |
| `src/studio-controller/turns.mjs` | `createTurnLog()`（有界的轮次日志） |

代理 1,005 → 853 行，控制器 1,558 → 1,522 行。

**第二步（进行中）**：把路由从闭包里搬成注册表。已落地：

| 新模块 | 内容 | 状态 |
|---|---|---|
| `src/studio-controller/router.mjs` | register/track/mount/rollback + 重复路径容忍 | 完成 |
| `src/studio-controller/routes/system.mjs` | asr、system/check、system/install + 共享快照 | 完成（3 条） |
| `src/studio-controller/routes/diagnostics.mjs` | client-log（枚举事件、512 B、仅本机浏览器） | 完成（1 条） |
| `src/studio-controller/routes/assets.mjs` | attachment（64-hex 摘要 → 对象库） | 完成（1 条） |
| `src/studio-controller/routes/chat.mjs` | mcp（唯一跳过 cookie 准入的路由） | 完成（1 条） |
| `src/studio-controller/routes/editing.mjs` | editing-sessions/prefs/archive/delete/delete-project | 完成（5 条） |

控制器 1,558 → 1,105 行。剩下的 2 条路由目标形态：

```text
src/studio-controller/
  index.mjs               createStudioController：构图 + 装配（目标 < 250 行）
  router.mjs              registerRoute/trackRoute/rollback（TDZ 保护留在这里）
  routes/editing.mjs      editing-sessions、editing-delete-project、archive
  routes/diagnostics.mjs  diagnose（依赖 lastProxy/turnLog/桥接状态）
  routes/debug.mjs        debug-url（依赖 runtime/proxyFor/debugBridge，最重）

已迁：system×3、client-log、attachment、mcp、editing×5、bootstrap。
```

每个 `registerX(deps)` 接收显式依赖（ctx、log、proxy、officialRpc、sessions…），不再捕获闭包。迁移顺序：先建 `router.mjs` 与依赖对象，再逐组搬路由，**每搬一组重跑 614 条测试**。

## 教训：抽出来的代码会静默失作用域

editing 五条路由搬出去时，第一版**编译通过、测试全绿**，但运行时会炸三处：

1. `basename` 忘了 import（`node:path`），列表一旦走到"用文件夹名兜底"就 500；
2. `officialStore` / `deleteEditingProject` / `acpAgentService` 是控制器闭包里的名字，
   没进依赖对象 → ReferenceError，而且只在点开侧栏时才出现；
3. `../editing-sessions.mjs` 的相对路径少了一层（应为 `../../`），模块加载即失败。

源码文本测试（本节开头列的那 6 个）一条都没抓到，因为它们读的是**字符串**，不是行为。
因此新增 `tests/editing-routes.test.mjs`：用桩件真的调用 handler，覆盖列表管道、405、
依赖抛错降级、外部 peer 拒绝。搬剩下的路由时按同样方式补一个调用测试，而不是只改断言。

## 代价

- 第一步收益有限（少 190 行），真正的可读性提升在第二步；
- 第二步要动 6 个"读源码"的测试：它们的断言会从"字符串在 controller 里"改成"字符串在对应 routes 模块里"。这是把隐式契约显式化，但迁移期间容易漏；
- 拆分后依赖对象会变长，调用点从 `f()` 变成 `f(deps, ...)`，单看一行反而更啰嗦——用目录结构换回来。

## 证据

`src/studio-proxy/{websocket,upstream}.mjs`、`src/studio-controller/{http-body,turns,router}.mjs`、`src/studio-controller/routes/{system,diagnostics,assets,chat,editing}.mjs`；`docs/reference/modules.md`（生成的行数清单）；`npm test` 618 条。
