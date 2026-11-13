# ACP 对话边车参考

> 本仓实现：`src/acp-client.mjs`（线级客户端）、`src/acp-agent-service.mjs`（会话/模型/权限）、
> `src/acp-session-store.mjs`（映射）、`src/acp-profile-models.mjs`（渠道同步）。
> 协议：ACP（Agent Client Protocol），stdio 上的 JSON-RPC。

## 1. 启动

```js
import { createAcpClient } from './acp-client.mjs';
const client = createAcpClient({ args: ['--profile', 'acp'], requestTimeoutMs: 180_000 });
await client.start();                  // spawn dsh --profile acp，握手
const session = await client.newSession({ cwd: projectDir });
// session = { sessionId, configOptions, ... }
```

- 子进程命令解析：`resolveAcpCommand()`（PATH、安装目录、`execPath` 兜底）；
- 每个项目一个子进程/会话；断开要 `close()`；
- 输出必须按 JSON-RPC 帧解析（不要按行读，忽略 stderr 噪声）。

## 2. 方法与事件

| 方向 | 方法/事件 | 用途 |
|---|---|---|
| 客户端 → agent | `initialize` | 能力协商 |
| 客户端 → agent | `session/new` | 建会话，返回 `configOptions` |
| 客户端 → agent | `session/resume` | 续聊（带 sessionId/cwd） |
| 客户端 → agent | `session/prompt` | 发消息（text/image blocks） |
| 客户端 → agent | `session/cancel` | 取消当前轮 |
| 客户端 → agent | `session/set_config_option` | 改模型/思考强度 |
| agent → 客户端 | `session/update` | 流式事件 |
| agent → 客户端 | `session/request_permission` | 审批询问（批准/拒绝） |

`session/update` 里常见：
- `agent_message_chunk`：助手正文；
- `agent_thought_chunk`：思考过程（一段段推送）；
- `tool_call` / `tool_call_update`：工具卡片；
- 计划/用量等，按 `kind` 分发。

## 3. configOptions（真机探测结果）

`session/new` 只返回两个选项：

| option | category | 值 |
|---|---|---|
| `model` | `model` | 分组：`DeepSeek` / `DeepSeek Account` / `opencode-go` / … |
| `reasoning_effort` | `thought_level` | `off/low/high/max`（第三方可能没有 `off`，出现 `Provider default`） |

- `model` 的 `currentValue` 是字符串化的数组：`"[\"opencode-go\",\"deepseek-v4.1-flash\"]"`；
- `set_config_option` 时传**同样的字符串化值**，不要传对象；
- **没有 permission/mode 选项**：权限不是 ACP 配置。

## 4. 模型应用与回退

```js
const selection = defaultSelection();            // ctx.agentDefaultModel.currentSelection()
const catalog = catalogFromConfigOptions(options);
const target = selection && catalog.groups.some(g => g.id === selection.provider && g.models.some(m => m.id === selection.model))
  ? selection
  : { provider: 'deepseek-official', model: 'deepseek-flash' };   // 官方 V4.1 兜底
await client.setConfigOption({ sessionId, configId: 'model', value: valueForChoice(options, target) });
```

- 选中的模型不在子进程目录里（如第三方渠道没同步）时，**必须兜底**，否则面板打不开；
- 兜底事件要打日志（如 `acp-model-fallback`），方便诊断；
- 旧模型可从菜单隐藏，但保留环境变量开关。

## 5. 权限

- 子进程启动时用环境变量传：`DSH_PERMISSION_MODE=danger-full-access|workspace-write|read-only`；
- Host 侧存项目 → 预设（`ctx.get('permissionPresets')` / storageDomain），改预设时**丢弃该项目的子进程**，下一轮按新预设重建；
- 权限与模型无关；不要因为换了第三方模型就禁用权限。

## 6. 会话映射与续聊

- 项目 → `{ sessionId, cwd }` 存 `$DSH_HOME/<插件>/acp-sessions.json`；
- DSH 会话本体：`~/.dsh/sessions/<编码后的 cwd>/<session-id>/session.v4.jsonl.zstd`；
- 重启后 `session/resume` 带上 sessionId/cwd；失败则新建；
- **不要删除/改名**用户会话目录；归档/恢复要走 DSH 的会话 API。

## 7. 图片

- 子进程声明支持图片 → 发内联 image block；
- 不支持 → 落临时文件，提示里给绝对路径，并允许重试一次；
- 不要依赖 500MB 上传通道。

## 8. 渠道同步（acp profile）

问题：`acp` profile 只装 `dsh-base + dsh-acp-app`，没有用户桌面 profile 的 `llm-pi-ai` 渠道 → 面板模型退回默认。

做法（幂等）：
1. 找到当前激活 profile 的 `cordis.patch.yml`（扫 `~/.dsh/profiles/*/package.json` 的 bundles 找宿主插件）；
2. 抽出其中 `llm-pi-ai` 的 provider 块；
3. 写入 `~/.dsh/profiles/acp/cordis.patch.yml`，用标记包住（`# begin/end`），只替换标记段，保留用户自己的条目；
4. 只抄渠道名/地址/模型/`apiKeyEnv`，密钥仍在 DSH 凭据里；
5. Host 启动时执行一次，失败只告警不阻塞。

## 9. 常见坑

| 坑 | 解 |
|---|---|
| 模型被拒 / 回退到默认 | 先确认子进程 `configOptions.model` 里有该渠道（同步后再试） |
| 思考不显示 | 模型/强度没生效，或事件只取 message 不取 thought |
| `set_config_option` 报错 | 值必须是字符串化数组；先读 `currentValue` 格式 |
| 续聊失败 | cwd 变了 / session 文件不在；用映射里的 cwd，不要用当前目录 |
| 子进程泄漏 | 每项目单例 + `close()` + Host dispose 时清理 |
| 面板打开卡住 | 初始化超时要可诊断（日志阶段：spawn/initialize/session/new） |
