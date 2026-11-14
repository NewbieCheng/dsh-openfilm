<!-- doc
id: ADR-0007-docs-and-baseline
reader: 维护者
fact-source: docs/index.md、scripts/docs-check.mjs、.github/workflows/ci.yml
checked: 0.15.3
rot-if: 文档分层被推翻，或 CI 不再是唯一守门人
-->

# ADR-0007：文档按寿命分层，检查项进 CI

- 状态：生效
- 日期：2026-11-14

## 背景

到 0.15.1 时，仓库有 16 篇文档、2,982 行，事实与进度混写，已经出现三类可验证的腐烂：

| 症状 | 证据 |
|---|---|
| 版本号三处不一致 | `package.json` 0.15.1 / `README.md` 「当前 0.13.0」/ `AGENTS.md` 0.15.1 |
| 路线图停在上古 | `ROADMAP.md` 「当前批：0.9.1」 |
| 事实表过期且重复维护 | `DSH-SHELL-INTEGRATION.md` 「插槽全表（77 个）」，真机为 116 |

同期工程侧有 607 条测试（9 秒跑完）和 4 个手写 check，但**没有 CI**、没有 `npm test` 入口、没有 lint、7.7 MB 的 tgz 提交进了 git。

## 决定

1. 文档按寿命分五条车道（规格/决策/参考/流程/进度），进度只允许出现在 `STATUS.md`、`ROADMAP.md`、`CHANGELOG.md`；
2. 每篇必须有属性块（`reader`/`fact-source`/`checked`/`rot-if`），`docs:check` 强制；
3. 能生成的清单不手写（路由、环境变量、模块清单、插槽表指向 skill）；
4. 所有检查进 CI：lint(strict)、test、docs/brand/templates/patches，外加"仓库里没有构建产物"和"check 不得改动工作区"两条断言；
5. 版本号只有 `package.json` 一个来源，README 与 STATUS 由检查脚本核对。

## 代价

- 每次事实变更多了一步"重生成 + 看 diff"，比手写慢；
- 属性块的 `checked` 会随时间落后，需要主动复核（落后两个 minor 会告警）；
- 有 CI 之后，"本地能跑"不再等于"可以合入"。

## 证据

`docs/index.md`、`scripts/docs-check.mjs`、`scripts/lint.mjs`、`.github/workflows/ci.yml`、本仓 0.15.1 的提交。
