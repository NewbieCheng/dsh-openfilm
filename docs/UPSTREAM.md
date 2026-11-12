# 上游同步手册

> 目标：**一条命令知道差多少，一条命令重放补丁，冲突落在具体文件上。**
> 上游是 OpenFilm（MIT）。我们不改它的 npm 包，只维护一层可重放的源码补丁 + 一份构建快照。

---

## 1. 三处 pin，必须一起动

| 位置 | 字段 | 作用 |
|---|---|---|
| `package.json` | `dependencies.openfilm` 的 tarball URL | 运行时版本（`studio-runtime.mjs` 从它推导） |
| `vendor/official-shell/manifest.json` | `version` + `commit` | 界面快照的上游身份 |
| `src/official-shell.mjs` | `OFFICIAL_COMMIT` | 加载时校验，不一致直接 `OFFICIAL_SHELL_UNAVAILABLE` |

`npm run upstream:status` 会把这三处和补丁系列放在一起对账；不一致时退出码为 1。

---

## 2. 目录

```text
patches/                   # 我们的补丁，放在快照之外：重生成快照不会删掉它们
  series.json              # 顺序、文件、分组、每个 patch 的 sha256
  010-App.patch            # 一个源文件一个补丁
  ...
vendor/official-shell/
  manifest.json            # 版本、commit、逐文件 sha256（含烘焙后的覆盖记录）
  ui/                      # 上游构建产物（Vite dist），不是源码
  source/                  # 上游许可证、package.json、lockfile（可追溯）
  patch.diff               # 生成物：全部改动的合并 diff
```

- **源文件补丁是事实来源**，`patch.diff` 是给人看的合并视图。
- 一个文件一个补丁：升级冲突时能直接说"`ModelPopover.tsx` 这个补丁不适用了"，而不是"第 1200 行冲突"。
- `series.json` 的 `group` 只是粗标签（chat / menus / onboarding / i18n / shared），不要拿它当功能边界。

---

## 3. 命令

| 命令 | 要 checkout | 做什么 |
|---|---|---|
| `npm run upstream:status` | 否 | 对账三处 pin + 补丁系列；`--online` 额外查 npm 最新版 |
| `npm run upstream:fetch` | 否 | 把固定 commit clone/checkout 到 `.upstream/openfilm`（可用 `NO996_UPSTREAM_DIR` 改） |
| `npm run upstream:verify` | 是 | 逐个 `git apply --check`，报告哪个文件冲突 |
| `npm run shell:dev` | 是 | 应用补丁 → 构建壳 → 复制到 `.dev/shell`；DSH 带 `NO996_OPENFILM_DEV_SHELL=1` 启动时直接读它（跳过 manifest 校验） |
| `npm run shell:pack` | 是 | 构建 → 生成新快照 → 重算 manifest → 跑壳相关测试 |
| `npm run shell:bake` | 否 | 把 `assets/theme/{tokens,shell}.css` 烘焙进 `ui/`（加一个 `<link>` + 重算 manifest），发版前跑；`--check` 校验是否最新 |
| `npm run patches:split` | 否 | 从 `patch.diff` 重新生成 `patches/` |
| `npm run patches:check` | 否 | 校验 `patches/` 与 `patch.diff` 一致（CI/提交前） |

> `shell:dev` / `shell:pack` 需要上游 monorepo 的依赖（首次 `pnpm install` 约 1–2 GB、10–20 分钟）。日常改样式不需要走这条路，见 `UI-PLAYBOOK.md`。

---

## 4. 改一处上游源码（A1）

```sh
npm run upstream:fetch
# 在 .upstream/openfilm 里改源码（只改 series.json 允许的文件）
npm run shell:dev                 # 构建到 .dev/shell
# DSH 用 NO996_OPENFILM_DEV_SHELL=1 启动 → 刷新面板 → 真机确认
npm run shell:pack                # 确认后生成正式快照
npm run patches:split             # 把新 diff 拆成每文件补丁
npm run patches:check
node --test tests/*.test.mjs
```

`build-official-shell.mjs` 的硬约束：

- 只接受固定 commit；工作树里出现计划外的改动直接失败。
- 只收白名单扩展名的 dist 文件；符号链接、计划外文件直接失败。
- **拒绝覆盖已有目录**：正式快照必须先输出到临时目录再替换，不能原地重写。

---

## 5. 升级到新上游（bump）

```sh
# 1. 读上游 release notes，确认 startStudio 契约、鉴权/Origin、Node/Chromium 要求
# 2. 更新 package.json 的 tarball URL
npm install
# 3. 取新 commit 的 checkout（先不要动 manifest）
npm run upstream:verify -- --dir <new-checkout>
# 4. 按报告修冲突；每修好一个文件，重跑 verify
# 5. 构建 + 快照 + 重算 manifest（version/commit 一起改）
npm run shell:pack -- --dir <new-checkout>
# 6. 更新 src/official-shell.mjs 的 OFFICIAL_COMMIT
npm run upstream:status           # 必须 problems none
node --test tests/*.test.mjs
```

**冲突处理原则：**

- 优先把我们的改动**重写**成上游的新结构，而不是硬贴旧 hunk。
- 上游已经实现的能力（例如错误边界、引导页）→ 删掉我们的补丁，不要双份。
- 一个补丁连续两次升级都要手工修 → 说明它选错了层，回到 `UI-PLAYBOOK.md` 重新判断。

---

## 6. 发布前检查

```sh
npm run upstream:status           # 三处 pin 一致
npm run patches:check             # 补丁系列与 diff 一致
node --test tests/*.test.mjs      # 全绿（跳过项除外）
npm run brand:check               # 品牌字段合法、主题文件在位
```

然后按 `AGENTS.md` §4 重载 + 刷新，在真实 GUI 里确认：面板能开、壳能渲染、登录/引导不回归。

---

## 7. 不能自动化的部分

- 上游构建产物的**来源可信性**：manifest 只证明"文件没坏"，不证明"这个 dist 是从这个 commit 构建的"。发布前要人工确认构建机与 lockfile。
- 第三方许可：上游通知很短，React / Inter / Lexical 的完整文本需要单独补齐。
- 上游的商标与品牌：见 `BRAND.md`。
- 真正的"自动更新"：我们发的是 DSH 插件，没有上游 electron-updater 通道。能做的只是"一条命令同步 + 冲突报告"。
