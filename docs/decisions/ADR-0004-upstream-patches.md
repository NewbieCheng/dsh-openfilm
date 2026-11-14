<!-- doc
id: ADR-0004-upstream-patches
reader: 维护者、升上游的人
fact-source: patches/series.json、vendor/official-shell/manifest.json、src/official-shell.mjs
checked: 0.15.1
rot-if: 上游提供可注入的扩展点，或本项目不再 vendored 上游
-->

# ADR-0004：上游用构建快照 + 按文件拆的可重放补丁

- 状态：生效
- 日期：2026-11

## 背景

官方桌面壳的界面必须改（引导、账号条、剪辑区、文案），但它是**构建产物**，没有可直接改的源码在仓里。三种做法：fork 整个上游、只做运行时注入、或"快照 + 补丁"。

## 决定

- `vendor/official-shell/` 存**构建产物快照**，`manifest.json` 记录版本、commit、逐文件 sha256；
- 改动写成源码补丁，放 `patches/`，**一个源文件一个补丁**，顺序与 sha256 记在 `patches/series.json`；
- 三处 pin 必须一致：`package.json` 的 `openfilm` tarball、`manifest.json`、`src/official-shell.mjs` 的 `OFFICIAL_COMMIT`；
- 样式不做成永久注入：`assets/theme/shell.css` 在发版前由 `npm run shell:bake` 烘焙进产物并重算 manifest（开发期才走运行时注入）。

## 代价

- 升级要重放整条补丁系列（数量见 `patches/series.json`），冲突落在具体文件上——这是刻意的，比 80 KB 大 diff 好定位；
- `patches:check` 必须校验 hash 与字节，否则"补丁与快照不一致"会静默发生；
- 快照 19 MB、440 个文件进 git；
- 手改 `vendor/official-shell/ui` 而不重算 manifest，启动即 `OFFICIAL_SHELL_UNAVAILABLE`。

## 证据

`patches/series.json`、`vendor/official-shell/manifest.json`、`scripts/split-patch.mjs`、`tests/` 里的补丁系列断言。
