# 0.5.0 改造清单：把"嫁接"做稳（流控 / 重连 / 自恢复）

> 写于 2026-11-10，针对三件事：对话卡顿、突然中断、中断后只能手动重试。
> 结论先放这里：**方向没偏，但工程实现偏了**——桥接层是逐个 bug 补出来的，缺三样基础设施：流控、重连重放、自恢复。
>
> 进度：**P0-1 已完成（0.4.2）**——SSE 背压改为排队 + drain，`retry: 3000`，单测覆盖。P0-2/3/4 与 P1 待做。

---

## 0. 方向核对：我们到底在做什么

**目标形态（保持不变）**：DSH 提供"官方 OpenFilm 桌面端"这一个门面，OpenFilm 以为自己在桌面端里跑；DSH 负责模型、会话、存储。**不改上游一行源码。**

现在实际做的，与这个形态一致：

| 我们做的事 | 是不是在改上游 |
|---|---|
| 用官方 npm 包 `openfilm@0.3.1`（tarball 钉死）启动 Studio | 否 |
| 用官方构建产物 `vendor/official-shell/ui`（`manifest.json` 逐文件 sha256 校验，commit 钉死） | 否 |
| 运行时注入 `window.openfilmDesktop`（官方桌面端本来就提供的门面） | 否，这是官方留的接缝 |
| 回环反向代理 + 改写少量响应头/路由 | 否 |
| **没有**改 `vendor/official-shell/ui/**` 或 `node_modules/openfilm/**` | 否 |

所以"嫁接"这条路是对的。**偏的不是方向，而是这层接缝的工程质量**：

- 流断一次就死（没有重连、没有重放）；
- 背压当错误（NodE 的 `write()===false` 是"慢"，不是"坏"，我们直接 close 了）；
- 面板没有自恢复（Studio 挂了/iframe 静默只能刷新整页）；
- 性能没有任何度量，只能靠感觉判断"卡"。

这四条正好对应你说的三个症状。下面按"根因 → 改法 → 验收"写。

---

## 1. 症状与根因（有代码位置）

### 1.1 突然中断 → 只能用重试按钮

**根因 A（最重要）：SSE 把背压当断线**

`src/official-event-stream.mjs:31`

```js
try { if (!response.write(value)) { close(); return false; } return true; }
```

Node 的 `response.write()` 返回 `false` 只表示"内核缓冲区满了，等 drain"，数据仍然排队。
这里直接 `close()`：流被掐断 → hub 的 listener 被移除 → 服务端下一次 `emit` 得到 `false` →
`official-agent-service` 抛 `OFFICIAL_AGENT_STREAM_LOST` → 归因后变成 `OUTCOME_UNKNOWN` → 页面 503 + 只能重试。

什么时候会打满缓冲区：工具结果（我们单条最多 8 KiB）+ 连续文本增量一起涌出、页面后台被限流、Studio 页面正在做大渲染。
这就是"有时候突然中断"的机制。

**根因 B：断线没有重连，更没有重放**

`src/official-facade.mjs` 的 `ensureAgentSource`：`source.onerror = fail` → `close()` + 删除 entry + 让当前 prompt 直接失败。
浏览器 EventSource 自己会重连，但我们主动关掉了；重连后也没有 `Last-Event-Seq` 补齐，断线期间的文本永久丢失。

**根因 C：Studio 进程没有监护**

`src/studio-runtime.mjs` 只有 `ensureStarted/close/status`，没有"进程崩了"的检测与重启；
一旦上游 Studio 退出，所有 `/api/*` 和 iframe 都失败，直到重启整个 DSH。

### 1.2 面板/对话卡顿

**这一条我目前没有性能数据，只有结构上的可疑点**（不装成结论）：

| 可疑点 | 位置 | 为什么可疑 |
|---|---|---|
| 每个 LLM 增量发一条 SSE、触发一次 React 更新 | `official-agent-service` pump → `emit` | 几十条/秒的小事件，官方 shell 的对话组件偏重 |
| 面板每 500ms 取一次矩形并写 style | `src/studio-entry.js:61` | 持续强制布局，和 iframe 里的重绘互相挤 |
| 归档轮询 5 秒一次，每次都打 Studio `/api/projects` | `src/studio-panel.mjs:134` | 后台标签页也在跑 |
| iframe 内是完整 Studio（时间线 + 视频预览） | 官方 shell | 重合成；`position:fixed` 容器跟随占位矩形 |

先埋点再动手，不做"感觉型优化"。

---

## 2. 改造清单

### P0-1 SSE 流控：慢客户端排队，不 close

**改**：`official-event-stream.mjs`

- 写前判断：`write()` 返回 false → **不关闭**，把后续帧放进队列，监听 `'drain'` 后按序 flush；
- 队列上限（512 帧 / 2 MiB）。超限时**只丢弃可合并的增量**（`agent_message_chunk` / `agent_thought_chunk` 合并成一条），
  `done` / `tool_call` / `tool_call_update` / 任何终态**永不丢弃**；
- 客户端真的断开（`close` 事件 / `destroyed`）才关闭；
- 出口加 `retry: 3000`（保留现有 25s keep-alive）。

**验收**：单测里用 `write: () => false` 的假 response，连续推 100 帧 → 不 close、顺序不变、drain 后全部到达；工具事件一条不少。

### P0-2 重连 + 重放

**改**：`official-event-hub` 增加每项目环形缓冲（最近 256 帧，带递增 seq）+ `official-event-stream` 支持 `?after=<seq>`；
`official-facade` 的 EventSource 改为自动重连（1s→2s→4s→8s，上限 15s），断线窗口 5 秒内的 prompt 不判失败；
重连成功后从 `after` 补齐，已渲染过的 seq 去重。

**验收**：手动断网 3 秒 → 恢复后当前回合文本连续、无重复、无缺失；单测覆盖 seq 去重与补齐。

### P0-3 面板自恢复（你要的那个按钮）

**改**：`studio-panel.mjs`

- 顶部状态点：`连接正常 / 重连中 / 工作台异常`；
- 「重新连接」按钮常驻（异常时高亮）：重跑 `bootstrap` 且**保持当前 `/projects/<id>` 路由**，不刷新整页；
- 触发自动重连：`boot` 20s 静默、iframe `onerror`、SSE 连续 3 次失败；
- 仍失败才显示「重启工作台」（`runtime.close()` + `ensureStarted()`）。

**验收**：杀掉 Studio 进程 → 面板 15s 内自动恢复且停在原项目；连续失败时不出现白屏。

### P0-4 Studio 进程监护

**改**：`studio-controller`

- 每 15s 探测 Studio `/api/projects`（3s 超时）；
- 连续 2 次失败 → 关闭 runtime 并重启一次（重启失败才上报）；
- `diagnose` 暴露 `studio: {running, restarts, lastError}`。

**验收**：手工 kill Studio → 下一次探测后自动拉起，`diagnose` 里 `restarts` +1。

### P1-1 增量合帧（降 CPU/重绘）

**改**：Host 侧按 (projectId, key, sessionUpdate) 合并 16–33ms 内的增量再 `emit`；工具事件不合并不延迟。
**验收**：同样的回复，SSE 条数下降 ≥ 5×，文本不丢字、不分段错位（单测：随机切分 → 合并 → 还原等值）。

### P1-2 面板定时器治理

**改**：`setInterval(place, 500)` → `ResizeObserver` + `requestAnimationFrame`（仅在可见且矩形变化时写 style）；
归档轮询 5s → 15s，且 `document.visibilityState !== 'visible'` 时暂停。
**验收**：静置 1 分钟，面板自身脚本调用次数 < 100（用 Performance 面板抽查）。

### P1-3 观测（先测后调）

**改**：`diagnose` 增加
`stream {eventsPerSec, bytesPerSec, coalesced, queued, droppedCoalescible, reconnects}`、
`rpc {count, p95ms}`、`studio {restarts}`；面板静默诊断块展示。
**验收**：能回答"卡在哪"：是 SSE 条数、是 RPC 往返，还是 iframe 自身渲染。

### P2 契约冻结（防止下次再靠猜）

- 把已录到的真实帧（`agent/inbox/spliced`、`user/message` 各 `source.kind`、`tool/call`、`tool/result`、`assistant/message`、`turn/end` 各 reason）固化成契约夹具；
- `diagnose` 报告 `shellVersion`（读 `vendor/official-shell/manifest.json`）；
- 升级上游时先跑契约测试，红了的项一律按"不支持 + 明确提示"降级，**不改上游**。

---

## 3. 顺序与验收总表

| 步 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| 1 | P0-1 背压 | 无 | 假 response 推 100 帧不 close |
| 2 | P0-2 重连重放 | 步 1 | 断 3s 文本连续 |
| 3 | P0-3 面板自恢复 | 步 2 | 杀 Studio 自动恢复 |
| 4 | P0-4 进程监护 | 步 3 | kill 后自动拉起 |
| 5 | P1-3 观测 | 步 1–4 | diagnose 有数字 |
| 6 | P1-1 合帧 / P1-2 定时器 | 步 5（有数据再调） | 条数 ↓、脚本调用 ↓ |
| 7 | P2 契约 | 独立 | 契约测试全绿 |

**全局验收**：连续对话 10 分钟不中断；人为断网/杀 Studio 都能自愈，且当前回合文本不丢；中断时用户看到的是"重连中/已恢复"，而不是死在那。

---

## 4. 明确不做

- 不改 `vendor/official-shell/ui/**`、不改 `node_modules/openfilm/**`；
- 不为了"看起来流畅"删功能（工具卡片、思考块、归档都保留）；
- 不在没有 `diagnose` 数字的情况下大改 UI；
- 不引入第三方重连/状态库（Host 侧都是 Node 原生能力就够）。
