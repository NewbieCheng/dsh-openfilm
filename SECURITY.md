# 安全说明

## 支持范围

只有最新发布版本（README 顶部的版本号）接受安全修复。`main` 分支的开发态不保证可用。

## 报告方式

请用 GitHub 的 [private security advisory](https://github.com/NewbieCheng/dsh-openfilm/security/advisories/new) 报告，**不要**开公开 issue。
请在报告里给出：DSH 版本、平台、复现步骤、影响（能读到什么/能执行什么）。

## 这个插件是什么

`dsh-openfilm` 是**本机回环集成**，不是沙箱：

- Host 拉起官方 OpenFilm Studio（临时回环端口），反向代理给浏览器；
- 浏览器里的官方界面由 Host 提供；
- 对话交给 `dsh --profile acp` 子进程，授权边界是 DSH 自己的权限模式与审批。

因此"谁能读到 Studio 端口"取决于**本机进程**，插件不做进程隔离。不要把它当作多租户或不可信用户之间的边界。

## 我们守住的几条

| 项 | 做法 |
|---|---|
| 账号 token | 只存在 Host（`auth-client`/`auth-bridge`），浏览器侧只拿状态，不回显 token |
| 写操作入口 | 自定义请求头 + 回环地址 + 同源校验（见 `docs/reference/api-routes.md`） |
| 日志 | `plugin-log` 统一写入并脱敏；不记 token、cookie、完整 prompt |
| 仓库 | 不提交密钥；`scripts/lint.mjs` 扫描常见密钥形态；`dist/` 与 `*.tgz` 不进 git |
| 依赖 | 运行时只依赖 `openfilm`（官方发行包）与 `zod`；升级需过 `patches:check` |

## 已知边界（不是漏洞）

- Studio 与插件都在同一台机器上，同一用户下其它进程可以访问回环端口；
- `NO996_OPENFILM_DEV=1` 会跳过账号门，只应在开发机使用；
- 官方 OpenFilm 的构建产物按上游许可证分发，其自身安全性由上游负责。

细节见 `docs/DEVELOPMENT.md` §6（安全模型）与 `docs/reference/api-routes.md`（每个写入口的守卫）。
