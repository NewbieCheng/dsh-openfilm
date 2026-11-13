# 诊断、测试与验收

## 1. 证据入口

| 证据 | 位置 | 用途 |
|---|---|---|
| 插件日志 | `%TEMP%\dsh-openfilm\plugin.log`（JSON Lines） | 事件、失败原因（自动脱敏） |
| Host 标记 | `%TEMP%\dsh-openfilm-host.json` | `version/pid/startedAt`，判断是否真的重载 |
| 诊断接口 | `POST /api/no996-openfilm/diagnose {projectId}` | 面板静默 20 秒自动贴出 |
| 会话目录 | `~/.dsh/sessions/<encoded-cwd>/<id>/` | 续聊/存储问题 |
| ACP 映射 | `~/.dsh/no996-openfilm/acp-sessions.json` | 项目 → sessionId |
| profile 补丁 | `~/.dsh/profiles/*/cordis.patch.yml` | 渠道/模型配置 |

**重载判定**：`startedAt` 必须更新；只看到 `host-start` 不算新代码生效。

## 2. 日志规范

- JSON Lines，一条一个事件；
- 字段：`event`、`projectId`（截断）、`reason`（错误码，不写完整报文）；
- **脱敏**：不写密钥、token、完整 prompt、用户文件内容、绝对路径（或只写 basename）；
- 关键事件：
  - `acp-model-fallback` / `acp-default-model-failed`：模型未应用；
  - `acp-model-providers`：渠道同步结果；
  - `permission-hint-unavailable`：权限存储不可用；
  - `route-already-mounted`：路由重复（重载残留）。

## 3. 测试命令

```sh
node --test --experimental-test-isolation=none tests/*.test.mjs
npm run docs:check
npm run brand:check
npm run patches:check
npm run theme-bake -- --check     # 如项目有主题烘焙
```

规则：
- 只用 mock / 假 ACP agent / `mkdtemp`；
- **禁止真实模型调用**；
- 临时 home：`OPENFILM_HOME`、`OPENFILM_LIBRARY_CACHE` 指向临时目录；
- 形状断言以真实子进程探测或假 agent 为准。

## 4. ACP 衔接验收（真机）

- [ ] 模型菜单出现自己的渠道；默认模型跟随 DSH 当前选择；
- [ ] 思考流一段段出现（`agent_thought_chunk`）；
- [ ] 工具卡片、审批卡片可交互；
- [ ] 权限预设可选，子进程按 `DSH_PERMISSION_MODE` 生效；
- [ ] 重启 Host 后能 resume 原会话；
- [ ] 失败时日志有明确事件；
- [ ] 未真机验证不写“完成”。

## 5. 常见故障排查顺序

1. **Host 真的重载了吗**：看 `startedAt`；
2. **客户端 build 了吗**：改的是源码还是 `client.js`；
3. **路由重复了吗**：看 `route-already-mounted`；
4. **子进程起了吗**：日志阶段（spawn/initialize/session/new）；
5. **模型目录对了吗**：直接跑 `dsh --profile acp` 探测 `session/new`；
6. **鉴权过了吗**：`admit` 拒绝码（403/401）；
7. **是不是 DSH 本体行为**：主聊天权限行等，插件改不了，别硬修。

## 6. 安全边界

- 插件不是沙箱；路由/工具都要做参数白名单；
- 密钥只从凭据/环境变量读，不落前端、不落日志、不进 URL；
- 不把“完全访问”默认写进注入层；
- 不手改用户会话/项目文件。
