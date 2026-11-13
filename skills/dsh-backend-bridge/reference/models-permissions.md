# 模型与权限参考

## 1. 模型目录从哪来

| 来源 | 说明 |
|---|---|
| `ctx.llm.listProviders()` / `listModels()` | Host 内的模型目录（桌面 profile 的渠道） |
| ACP `configOptions.model` | 子进程（`acp` profile）自己的目录，可能不同 |
| profile `cordis.patch.yml` | `llm-pi-ai` 的 `providers` 定义渠道 |

### `llm-pi-ai` 配置块（示例）

```yaml
- id: llm-pi-ai
  config:
    providers:
      - id: opencode-go
        name: opencode-go
        baseURL: https://...
        api: openai-completions
        apiKeyEnv: OPENCODE_GO_API_KEY
        models:
          - id: deepseek-v4.1-flash
            name: DeepSeek V4.1 Flash
          - id: muse-spark-1.3-contributor
            name: Muse Spark 1.3 Contributor
```

- 密钥只写 `apiKeyEnv` 引用；真实密钥在 DSH 凭据里；
- 第三方渠道的 `reasoning_effort` 可能没有 `off`（显示 `Provider default`）。

## 2. 默认模型

```js
const selection = ctx.agentDefaultModel.currentSelection(); // { provider, model, reasoningEffort? }
```

- 应用到 ACP：`session/set_config_option`（值必须与 `configOptions` 里的格式一致）；
- 选中项不在目录里（渠道没同步/模型下线）→ **兜底**官方 V4.1 Flash，并记日志；
- 思考强度跟随 DSH 侧选择；子进程不支持时退回默认。

## 3. 旧模型的隐藏

- 菜单里隐藏已下线的模型（如 `deepseek-v4-flash`），但保留环境变量开关（如 `NO996_OPENFILM_KEEP_V4_FLASH=1`）；
- 隐藏只影响菜单，不影响已有会话（旧会话仍能 resume）。

## 4. 权限（项目级，不是模型级）

```
项目 → 权限预设（完全访问 / 项目访问 / 只读）
   → 子进程启动时 DSH_PERMISSION_MODE=...
   → DSH 沙箱 + 审批按该模式执行
```

- 存储：`ctx.storageDomain` 域（本仓 `no996_openfilm_project_permissions`），或 `permissionPresets`；
- 默认：`danger-full-access`（完全访问），新项目直接可写；
- 改权限：写预设 + **丢弃该项目的子进程**，下一轮按新预设重建；
- 权限与所选模型无关；不要按模型禁用权限 UI。

## 5. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 模型菜单没有你的渠道 | acp profile 没同步 provider | 启动时同步（见 `acp.md` §8） |
| 选模型后“没反应” | `set_config_option` 值格式错/被拒 | 读 `currentValue` 格式，按同样格式传 |
| 思考强度没有“关闭” | 第三方 provider 不支持 off | 显示“Provider default”，不要报错 |
| 权限行消失/灰 | DSH 主聊天按预设控制 UI | 面板走项目预设；主聊天属 DSH 本体 |
| 续聊模型变了 | 子进程重建后没重新应用选择 | resume 后重放 `set_config_option` |
| 日志里 `acp-model-fallback` | 选择不可用已兜底 | 检查渠道同步与模型名 |

## 6. 安全边界

- 权限预设不是沙箱：只读/项目访问仍要依赖 DSH 的 sandbox 与审批执行；
- 不要把“完全访问”作为默认写进注入层或前端可改的明文；
- 任何“直接执行命令”的能力都要有明确的项目边界与审计日志。
