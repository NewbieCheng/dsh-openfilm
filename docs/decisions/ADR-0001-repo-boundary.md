<!-- doc
id: ADR-0001-repo-boundary
reader: 维护者
fact-source: package.json 的 files/dsh.bundle、cordis.patch.yml
checked: 0.15.7
rot-if: 并入工作台、或改变分发形态
-->

# ADR-0001：独立仓分发，不做工作台分支

- 状态：生效
- 日期：2026-10

## 背景

产品既要在自己的桌面工作台里出现，又要能被别人当作 DSH 插件安装。两条路：

1. 在工作台仓库里开分支，共享代码；
2. 独立仓，靠清单（`files` 白名单 + `dsh.bundle.patch` + `dsh.client`）划出可分发边界。

## 决定

独立仓。分发单元是 npm 包；`files` 白名单决定什么进包，`cordis.patch.yml` 决定插进哪个 profile。

## 代价

- 两边代码不共享：`vendor/film-doc.mjs` 只能是一份副本，改一处要记得另一处；
- 工作台侧的改动不能"顺手"带过来，必须经过补丁/版本；
- 仓里带着 `vendor/`（19 MB、440 个文件）与 `patches/`（25 个），clone 比普通库重。

## 证据

`package.json` 的 `files` 与 `dsh` 字段；`cordis.patch.yml`；`tests/` 里对清单的断言。
