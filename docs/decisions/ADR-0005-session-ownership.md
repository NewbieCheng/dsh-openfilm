<!-- doc
id: ADR-0005-session-ownership
reader: 维护者、要动会话/归档的人
fact-source: src/archive-bridge.mjs、src/official-chat-store.mjs、DSH 的 sessions/workspaceRegistry 契约
checked: 0.15.2
rot-if: DSH 开放会话搬移/归组 API
-->

# ADR-0005：会话、归档、增量都归 DSH，不建自己的真相

- 状态：生效
- 日期：2026-11

## 背景

"项目"在 DSH 里是工作区，"对话"是会话。我们曾试图在 Host 侧维护会话 ↔ 项目的绑定表，结果两次踩坑：绑定表不校验归档 → 每次发送 503；把"会话属于哪个工作区"当成会话自身字段 → 对话永远掉进「未分组」。

## 决定

- 会话列表、归档状态、增量顺序一律以 DSH 的服务为准（`sessions` / `sessionPersistence` / `workspaceRegistry`）；
- 本地只存"提示性映射"（`acp-sessions.json`、`storageDomain` 里的绑定），**永远不作为真相**；
- 归档走 `workspaceController`；官方缺 API 的操作（如把已有会话搬进工作区分组）**明确拒绝**，不自己改文件；
- 对话失败的归因只有两种：已归因（可安全重发）与未归因（要人确认）；不自动重发未归因的回合；
- 增量按 index 去重、允许跳跃与接管，不反向把 "unchanged" 当流失效。

## 代价

- 能力受 DSH 约束：没有 attach API，存量空会话只能换新，非空旧会话留在「未分组」；
- 用户会看到"这个操作做不了"，而不是一个大概能用的近似实现；
- 跨工件操作（如归档项目的会话）需要显式顺序（先停活动，再移目录），比"直接改文件"啰嗦。

## 证据

`docs/playbooks/incident.md` 的两次故障记录；`tests/workspace-*.test.mjs`、`tests/official-chat-store-*.test.mjs`。
