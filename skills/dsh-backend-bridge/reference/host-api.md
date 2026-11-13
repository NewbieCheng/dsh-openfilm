# Host API 参考

> 来自本仓 `index.js` / `src/studio-controller.mjs` 的真机实现；通用模式，换成你自己的插件名即可。

## 1. 依赖注入

```js
export const inject = ['tools', 'connection', 'webServer', 'llm', 'agentDefaultModel',
  'storageDomain', 'sessionController', 'systemPrompt', 'agents'];

export function apply(ctx) {
  ctx.effect(() => createController(ctx, deps), 'my-plugin: controller');
}
```

- `apply` 必须同步、轻；重活放 `ctx.effect`/异步初始化。
- `ctx.effect(setup, label)` 的返回值是 disposer；**路由、定时器、子进程、监听**都放这里。
- 可选服务用 `ctx.get('服务名')` 取，取不到要降级，不能抛。

## 2. 常用服务

| 服务 | 用途 | 关键 API |
|---|---|---|
| `ctx.tools` | 注册模型可调用的工具 | `register(tool)` |
| `ctx.connection` | 鉴权/来源校验 | `admit({headers})`、`browserPeer.id` |
| `ctx.webServer` | 注册 HTTP 路由 | `register({kind:'exact', path, handler})`（一次一个） |
| `ctx.llm` | 列渠道/模型、流式调用 | `listProviders()`、`listModels()`、`stream()` |
| `ctx.agentDefaultModel` | 当前选中的模型 | `currentSelection()` |
| `ctx.storageDomain` | 插件持久化 | 域读写（JSON） |
| `ctx.sessionController` | DSH 会话 | 会话创建/查询（按 DSH 版本） |
| `ctx.systemPrompt` | 系统提示 | 追加/注册 |
| `ctx.agents` | agent 生命周期 | 创建/查询 |
| `permissionPresets`（`ctx.get`） | 权限预设 | `set(session, name)`、`list()` |

## 3. 路由模板

```js
function mount(ctx, path, handler) {
  const dispose = ctx.webServer.register({ kind: 'exact', path, handler });
  ctx.effect(() => dispose, `my-plugin: ${path}`);
}

mount(ctx, '/api/my-plugin/ping', async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }).end(); return; }
  const admission = ctx.connection.admit({ headers: req.headers });
  if ('rejection' in admission) { res.writeHead(admission.rejection).end(); return; }
  if (admission.peer.id !== ctx.connection.browserPeer.id) { res.writeHead(403).end(); return; }
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
});
```

### 鉴权三层

1. `ctx.connection.admit({headers})`：Origin/Host/会话三项校验；
2. `peer.id === ctx.connection.browserPeer.id`：只接受**已认证浏览器**；
3. 业务参数白名单：路径/项目 id/命令参数都要校验，不能透传。

### 流式响应

- 用 `text/event-stream` 或 chunked；每块 `res.write()`，结束 `res.end()`；
- 客户端断开（`req.on('close')`）要取消后端工作；
- 不要用长轮询做高延迟事件（可接受时优先 SSE）。

## 4. 存储

- 用 `ctx.storageDomain`，不要自己找 `~/.dsh` 下的文件；
- 需要跨进程共享时（如 ACP 子进程），用明确的 JSON 文件 + 原子写（临时文件 + rename）；
- 路径：`$DSH_HOME/<插件名>/...`；`$DSH_HOME` 默认 `~/.dsh`。

## 5. Profile 补丁

```yaml
- insert:
    - id: my-plugin
      name: my-plugin
      config:
        port: 0        # 0 = 让系统分配
```

- `!!js` 支持条件（如平台判断）；
- 修改后重新 `install_bundle` 或重启 Host；
- 不要在补丁里写密钥，写 `apiKeyEnv` 引用。

## 6. 生效矩阵（改完为什么没生效）

| 改了 | 要做什么 |
|---|---|
| Host 源码 | `touch index.js src/*.mjs` → 重载插件 → 刷新 |
| 客户端源码 | `npm run build` → 刷新 |
| `cordis.patch.yml` | 重新 `install_bundle` 或重启 Host |
| 静态资源/样式 | 保存 + 刷新 |
| 插件安装/升级 | `install_bundle`，按 `nextStep` 重启 |

## 7. 反模式

- ❌ 在模块顶层读文件/连数据库（测试无法隔离）；
- ❌ 路由里信任 `Origin` 或任意 URL；
- ❌ 把密钥写进前端/日志/URL；
- ❌ 用 `process.exit`/全局状态做清理；
- ❌ 注册路由不保 disposer（重载后残留 → 再启用失败）。
