# 热更新指南（边改边看）

本仓分三层，热更新的代价完全不同。先看这张表，再看下面的具体做法。

| 你要改的东西 | 文件 | 生效方式 | 要 build | 要重载插件 |
|---|---|---|---|---|
| 叠在官方界面上的 UI（模板下拉、重启卡片、隐藏「视频复刻」） | `assets/shell-ui.js` | **保存 → 刷新工作台页面** | 否 | **否** |
| 面板 UI（`shell.overlay` 里的界面、语言、状态条） | `src/studio-entry.js`、`studio-panel.mjs`、`panel-keepalive.mjs` | `npm run dev` 自动 rebuild → 刷新 DSH 页面 | 自动 | 否 |
| Host 逻辑（代理、会话桥、模板桥、归档、日志） | `src/*.mjs`、`index.js` | 重载插件 → 刷新页面 | 否 | **是** |
| 官方 shell 外观 | `vendor/official-shell/ui/**` | 重生成 manifest → 重载插件 | **是**（`scripts/build-official-shell.mjs`） | 是 |
| 模板影片本身（画面、版式、内容） | `vendor/templates/**` | **下一次请求即时生效**；工作台页面刷新后重新渲染 | 否 | 否 |

---

## 一、开一个 dev 终端

```sh
npm run dev
```

它会做三件事：

1. 监听 `src/studio-entry.js` → 自动重建 `client.js`（面板 UI 的产物）；
2. 监听 `src/**/*.mjs` → **改动后自动 touch 整个 Host 模块图**（原因见下面的坑）；
3. 打印每次构建的结果和下一步该做什么。

`Ctrl+C` 停止。发布前记得跑一次 `npm run build`（产物 banner 会从 dev 换成正式文案）。

---

## 二、最常用的一档：改 `assets/shell-ui.js`，只要刷新

这个文件是**注入到官方页面 `<head>` 的脚本**，Host 在**每次页面渲染时读盘**（按 mtime 缓存）。

```
改 assets/shell-ui.js  →  保存  →  在工作台里按 F5（或点页面内「重新启动工作台」）→ 看到新样子
```

不用 `npm run build`，不用重载插件，不用重启 DSH。

> 实测（0.5.2）：同一次插件装配下，编辑前后各渲染一次 `/`，注入内容从 44430 字节变成 44450 字节，探针标记出现。
> 这条是最值得记住的：**90% 的界面微调都在这个文件里。**

能改什么：模板下拉的位置与样式、隐藏哪些卡片、故障卡片的文案与按钮、`__no996Probe()` 探针。

不能改什么：需要 Node 侧能力的（读文件、签发票据、写日志）——那些在 Host，属于第三档。

---

## 三、面板 UI：`npm run dev` + F5

`client.js` 是 `src/studio-entry.js` 的打包产物，由 DSH 在**页面加载时**取一次。

```
终端 A：npm run dev      # 保存源码 → 自动 rebuild
浏览器：F5               # 取新的 client.js
```

如果 F5 后没变化，说明拿到的是缓存：`Ctrl+Shift+R` 强刷（或确认 `npm run dev` 打印了 rebuilt）。

---

## 四、Host 逻辑：重载插件 + F5

Host 模块由 DSH 的加载器按需重新求值。改完 `src/*.mjs` 后：

1. `plugin_manager set_plugin enabled=false target=include:dsh-openfilm`
2. `plugin_manager set_plugin enabled=true  target=include:dsh-openfilm`
3. 浏览器 F5

`npm run dev` 在文件改动时会替你 touch 整张模块图；没有运行 watcher 时需手动 touch。管理器的每次操作都要检查返回的 `application` 和 `nextStep`，不能保证 disable/enable 一定立即应用。

### 为什么必须 touch（这是本仓最容易踩的坑）

加载器会**只重新求值 mtime 变了的模块**。如果你只改了 `shell-extras.mjs`，而它的引入方 `studio-proxy.mjs` 没变，就会被缓存住——界面看起来"没生效"，其实是旧代码在跑。

检查 `%TEMP%\dsh-openfilm-host.json` 的 `version`/`startedAt` 和 `%TEMP%\dsh-openfilm\plugin.log` 的 `host-start`/`studio-warm`：它们能证明 Host 重建或未重建，但**不能单独证明所有客户端与插件状态已应用**。2026-11-11 曾出现 Host 已重建、管理器却返回 `restart-required`；此时必须如实报告，按 `nextStep` 完整重启 DSH，再刷新并在真实 GUI 验证。重启和刷新前提醒用户保存未保存的编辑。

---

## 五、怎么改"官方界面本身"（重要边界）

理解你的模型：**这个页面就是官方 OpenFilm 服务经本插件代理后的样子**，所以改它的代码会改外观——但要分清三层：

| 层 | 能不能改 | 后果 |
|---|---|---|
| `vendor/templates/**`（你的影片页） | **可以，而且推荐** | 下一次请求即生效，最安全 |
| `assets/shell-ui.js`（叠加层） | **可以** | 刷新即生效，不碰上游 |
| `vendor/official-shell/ui/**`（上游 shell 构建产物） | 谨慎 | 必须用 `scripts/build-official-shell.mjs` 重算 `manifest.json`；**手改而不更新 manifest → 启动直接 `OFFICIAL_SHELL_UNAVAILABLE`**（逐文件 sha256 校验） |
| `node_modules/openfilm/**` | **不要改** | 升级即被覆盖；版本与 `vendor/official-shell` 的 commit 绑定 |

也就是说：**想改外观，优先改模板页和叠加层；确实要改 shell，就走官方的构建脚本**，别手改。

---

## 六、DSH 自己的 HMR 管不到本插件

DSH 的客户端插件热替换只在用 `pnpm run dev:web` 从同一个 DSH checkout 起服务时成立。本插件是已安装的第三方包，不在这条链路上。

实测：直接修改 `src/plugin-log.mjs` 后等待 12 秒，日志里**没有**新的 `host-start`——DSH 没有监听本包。所以 Host 侧的重载只能靠上面第四档（或在 `plugin_manager` 里点两下）。

---

## 七、发布前检查

```sh
npm run build                      # 正式产物（banner 与 dev 不同）
node --test tests/*.test.mjs       # 最近一次 192 项 / 191 通过 / 1 跳过
```

然后按 `AGENTS.md` §4.1.1 重载一次，确认日志里 `host-start.version` 是新版本、`studio-warm` 没有失败。
