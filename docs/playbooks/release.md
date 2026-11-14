<!-- doc
id: playbooks-release
reader: 发版的人
fact-source: package.json、CHANGELOG.md、scripts/*、.github/workflows/ci.yml
checked: 0.15.1
rot-if: 换发布渠道，或版本流程变化
-->

# 流程：发版

> 版本号只有 `package.json` 一个来源。README 与 `STATUS.md` 由检查脚本核对，不再手写"当前 0.x"。

## 1. 发版前

```sh
npm ci
npm run check          # lint(strict) + test + docs/brand/templates/patches
npm run shell:bake     # 把主题烘焙进 vendor/official-shell/ui 并重算 manifest
npm run build          # src/studio-entry.js → client.js
```

`npm run check` 必须全绿。它等价于 CI，本地红着就别发。

版本号、CHANGELOG 小节、STATUS 的版本、锁文件版本、同名 tag —— 这五项由
`npm run release:check` 一次核对（草稿阶段可 `-- --allow-dirty`）：

```sh
npm run release:check          # 净仓 + 版本一致 + CHANGELOG/STATUS 有小节 + tag 未占用
```

## 2. 版本与记录

1. `package.json` 的 `version` +1（语义：修 bug → patch，加能力 → minor，破坏契约 → major）；
2. `CHANGELOG.md` 顶部加一节，写**结论**不写过程：改了什么、为什么、测试数；
3. `docs/STATUS.md` 更新 §1（仓库版本/最近发布）与 §2（这批做完什么）；
4. `docs/ROADMAP.md` 把做完的项移到"已做"或删掉。

四者必须同一批改。版本号不一致会让"现在到底哪个版本"永远说不清——这正是 0.15.1 之前发生的事（`README` 写着 0.13.0）。

## 3. 打包与发布

```sh
rm -rf dist && mkdir dist
npm pack --pack-destination dist
gh release create v0.15.2 dist/dsh-openfilm-0.15.2.tgz --title "0.15.2" --notes-from-tag
```

- `dist/` 与 `*.tgz` 已在 `.gitignore` 里，**不进 git**；
- 发布包内容以 `package.json` 的 `files` 为准：`index.js`、`client.js`、`assets`、`brand`、`patches`、`skills`、`src`、`vendor`、`scripts`、`cordis.patch.yml`、`locale`、`icon.svg`、`README.md`、`CHANGELOG.md`、`AGENTS.md`、`docs`、`LICENSE`；
- 打完包做一次"装上去"验证：`install_bundle` 指本地 tgz，看插件管理器是否报 `restart-required`。

## 4. 发布后

1. 核对 Releases 资产大小与 sha256；
2. 在 `STATUS.md` §1 把"最近发布包"改成新版本；
3. 若这次动了侧栏注入、ACP 权限、上游 pin：把对应项加进 [`verify.md`](verify.md) 的回归清单。

## 5. 回滚

- 插件层：`dsh plugin remove` 或把 profile 里那一行 `disabled: true`，再装回上一个 tgz；
- 代码层：`git revert <commit>`；删除类改动（如 0.13.0 删旧回合路径）在设计时就要求"单提交可回滚"；
- 上游 pin：三处（`package.json` tarball、`manifest.json`、`OFFICIAL_COMMIT`）一起退回。

## 6. 不要做

- 不要手改 `dist/` 里的东西再发布；
- 不要在有未提交改动时发版（`git status` 必须干净）；
- 不要跳过 `shell:bake`：产物里的主题与 `assets/theme/*.css` 会不一致；
- 不要把"CI 绿了"当"真机验证过了"——两者是不同证据。
