<!-- doc
id: ADR-0003-acp-boundary
reader: 维护者、要改对话链路的人
fact-source: src/acp-client.mjs、src/acp-agent-service.mjs、docs/ARCHITECTURE.md
checked: 0.15.7
rot-if: DSH 提供稳定的进程内 agent API，或改用 MCP/其它协议
-->

# ADR-0003：对话交给 `dsh --profile acp`，Host 不自己实现回合

- 状态：生效
- 日期：2026-11-13（旧路径已删除）

## 背景

官方 Studio 的聊天列需要一个 agent。可选：

1. Host 进程内自建 agent loop（模型、工具、审批、压缩全自己写）；
2. 起 `dsh --profile acp` 子进程，用 ACP（stdio JSON-RPC）驱动。

选项 1 需要复刻 DSH 的模型目录、审批、思考流、上下文压缩、续聊——每一块都会与 DSH 分叉。

## 决定

ACP 是**唯一**对话路径。Host 只做三件事：拉起子进程、把 Studio 聊天列的 UI 映射到 ACP 的 `configOptions` 与流式 `session/update`、把工具通过 MCP 端点交给子进程。

2026-11-13 已删除旧的进程内回合路径（`official-agent-service`、`official-agent-events`、旧会话绑定、旧审批桥、旧系统提示注入），删除前在独立 worktree 跑通全量测试，并保留 `git revert` 单提交可恢复。

## 代价

- 多一个进程与一份 `acp` profile，模型渠道要在两处同步（`src/acp-profile-models.mjs`）；
- ACP 只给两个 `configOptions`（model、reasoning_effort），**权限不是 ACP 选项**，只能靠 `DSH_PERMISSION_MODE` 在建进程时定，改权限 = 重建子进程；
- 会话在子进程侧，Host 只存映射（`$DSH_HOME/no996-openfilm/acp-sessions.json`）；
- 版本敏感：`session/resume`、`mcpServers` 形状都随 DSH 变，升级要复测。

## 证据

`src/acp-client.mjs`（线级客户端）、`src/acp-agent-service.mjs`（`ensure()` 与 `DSH_PERMISSION_MODE`）、`docs/ARCHITECTURE.md` §3/§9。
