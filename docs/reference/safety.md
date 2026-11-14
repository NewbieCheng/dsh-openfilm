<!-- doc
id: safety
reader: 维护者、reviewer、写新路由的人
fact-source: src/studio-proxy.mjs、src/workbench-auth.mjs、src/auth-bridge.mjs、SECURITY.md
checked: 0.15.6
rot-if: 新增对浏览器的信任假设，或改动鉴权链路
-->

# 安全模型

> 一句话：**这是本机回环集成，不是沙箱。** 所有"安全"都建立在"同机同用户"的假设上，往上加的任何校验都是纵深，不是边界。

## 1. 三个信任假设

| 假设 | 含义 | 破了会怎样 |
|---|---|---|
| 同机 | Studio 端口只监听回环 | 同机其它进程可以访问（不受我们控制） |
| 同用户 | 浏览器 cookie 只属于这位用户 | 多用户共用一台机器时不适用 |
| 官方窗口 | 编辑器 Origin 视为"本机这位用户的官方窗口" | 项目 ID 每次都要经 Studio 实时列表校验 |

## 2. 必须成立的校验

| 位置 | 校验 |
|---|---|
| 新增 Host 路由 | 只收本机 DSH 浏览器（`ctx.connection.admit` / `requestRejection`）；只读写明确字段；体积上限；错误只回码 |
| 代理层 | cookie、`Host`、`Origin`；WS 逐帧校验 |
| 项目操作 | 项目 ID 经 Studio 实时列表核对；删除前 realpath + `.openfilm/.film/film.html` 校验 |
| 模板桥 | 白名单 + 单条消息 1 KiB |
| 日志 | `plugin-log` 统一脱敏：`path`/`session`/`cookie` 写成 `[redacted]`，换字段名（`route`/`authed`） |

## 3. 明确不做沙箱的东西

- 官方 film 页面（L3）可含任意可执行 HTML/JS，**没有渲染沙箱**。不要在 DSH Origin 里执行它；
- Studio 代理只是转发，不隔离；
- 注入层（`assets/*.js`、`assets/theme/*`）不得承载权限、凭据、业务写操作——它只做展示与转发到既有 RPC。

## 4. token 与账号

- 工作台账号 token 只在 Host（`src/workbench-auth.mjs`、`src/auth-client.mjs`），浏览器侧只拿状态，不回显；
- 存 `$DSH_HOME/no996-openfilm/workbench-auth.json`，权限按用户文件；
- `NO996_OPENFILM_DEV=1` 跳过账号门，只应在开发机使用。

## 5. 新增路由的模板

```text
1) 方法 + 路径精确匹配（不用通配）
2) 先 ctx.connection.requestRejection，需要 peer 再 admit
3) 写操作加自定义请求头 + 回环地址 + 同源校验
4) JSON body 有上限（64 KiB 量级），超限即拒
5) 响应 cache-control: no-store
6) 错误只回固定词表（不把上游 stderr、命令、路径透给浏览器）
7) 用 ctx.effect 持有 disposer，卸载即摘除
```

具体实现与逐条守卫见 [`api-routes.md`](api-routes.md)（生成）与 `SECURITY.md`。

## 6. 报告漏洞

用 GitHub private security advisory，不要开公开 issue。见 [`../../SECURITY.md`](../../SECURITY.md)。
