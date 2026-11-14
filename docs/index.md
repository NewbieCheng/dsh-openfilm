<!-- doc
id: index
reader: 所有人（第一次进仓库）
fact-source: 本目录下的文件清单
checked: 0.15.7
rot-if: 新增/删除 docs/ 下的顶层文档
-->

# 文档索引

> 这个仓库的文档按**寿命**分层，不按主题堆在一个文件里。
> 一条经验：事实几周不变，决策几月不变，进度每天变——混写在一起，整篇就会跟着进度一起烂。

## 1. 六条车道

| 车道 | 放什么 | 寿命 | 目录 |
|---|---|---|---|
| **规格** | 系统长什么样、边界在哪 | 几月～几年 | [`ARCHITECTURE.md`](ARCHITECTURE.md)、[`DEVELOPMENT.md`](DEVELOPMENT.md) |
| **决策** | 为什么这么定、代价是什么 | 永久（只追加） | [`decisions/`](decisions/README.md) |
| **参考** | 可以生成的事实：路由、环境变量、模块、层、登记表 | 随代码 | [`reference/`](reference/) |
| **流程** | 改界面、发版、升上游、出事怎么办 | 稳定 | [`playbooks/`](playbooks/) |
| **主题/功能** | 横切多层的专题、单一功能的设计 | 随功能 | [`topics/`](topics/)、[`features/`](features/) |
| **进度** | 现在到哪了 | 每天 | [`STATUS.md`](STATUS.md)、[`ROADMAP.md`](ROADMAP.md)、[`../CHANGELOG.md`](../CHANGELOG.md) |

跨领域、横切多层（L0–L3）的材料放 [`topics/`](topics/)，一篇一个主题（例：[`topics/copy-and-branding.md`](topics/copy-and-branding.md)）；按功能写的放 [`features/`](features/)，一功能一篇（例：[`features/editing-delete.md`](features/editing-delete.md)）。主题不是杂物抽屉：能归到决策/参考/流程的，不放这里。

**铁律**：进度只允许出现在最后一行那三个文件里。`ARCHITECTURE`、`reference/`、`playbooks/` 里出现"这个功能已经做到某版本"这类叙述即视为文档缺陷，`docs:check` 会失败。

## 2. 从这里开始

| 你是 | 先读 | 再读 |
|---|---|---|
| 智能体 | [`../AGENTS.md`](../AGENTS.md) | [`reference/`](reference/) 与 [`playbooks/ui-change.md`](playbooks/ui-change.md) |
| 新开发者 | [`DEVELOPMENT.md`](DEVELOPMENT.md) | [`ARCHITECTURE.md`](ARCHITECTURE.md) → [`decisions/`](decisions/README.md) |
| 改界面的人 | [`reference/ui-layers.md`](reference/ui-layers.md) | [`playbooks/ui-change.md`](playbooks/ui-change.md) → [`reference/injection-registry.md`](reference/injection-registry.md) |
| 维护上游的人 | [`playbooks/upstream-bump.md`](playbooks/upstream-bump.md) | [`reference/api-routes.md`](reference/api-routes.md) |
| 验收的人 | [`STATUS.md`](STATUS.md) | [`playbooks/manual-acceptance.md`](playbooks/manual-acceptance.md) |
| 排障的人 | [`playbooks/incident.md`](playbooks/incident.md) | [`../AGENTS.md`](../AGENTS.md) §7 证据入口 |
| 只想知道"现在能干嘛" | [`../README.md`](../README.md) | [`STATUS.md`](STATUS.md) |

## 3. 每篇文档的属性块

每篇必须有，`docs:check` 强制：

```html
<!-- doc
id: 唯一 id（等于文件名，或目录下的短名）
reader: 谁读
fact-source: 这些事实来自哪（源码路径 / 生成脚本 / 上游仓库）
checked: 最后核对时的版本（等于 package.json 的版本，或 `generated`）
rot-if: 什么变了这篇就该重写
-->
```

- `checked` 落后当前版本 **两个 minor** 以上 → 警告；落后三个 → 失败。目的是让腐烂可见，而不是假装不会腐烂。
- 生成的文档写 `checked: generated`，并注明生成命令。

## 4. 专题（长期稳定，单独成文）

| 文档 | 内容 |
|---|---|
| [`TEMPLATES.md`](TEMPLATES.md) | L3 影片/模板的构建与校验 |
| [`MOTION.md`](MOTION.md) | 动效生产 + 风格库/镜头卡（后两节由 catalog 生成） |
| [`reference/kit.md`](reference/kit.md) | 模板、单元、风格、镜头卡的数量与清单（生成；正文不写数） |
| [`topics/ui-plan.md`](topics/ui-plan.md) | 界面改造方案（人话版，含批次与验收） |
| [`TRANSCRIBE.md`](TRANSCRIBE.md) | 本地口播转写 |
| [`BRAND.md`](BRAND.md) | 品牌替换与法务边界 |
| [`DSH-SHELL-INTEGRATION.md`](DSH-SHELL-INTEGRATION.md) | DSH 三栏外壳改造案例（插槽细节见 `dsh-ui-extension` skill） |

## 5. 新增一篇文档前

1. 它属于哪条车道？如果"既讲结构又讲进度"，拆成两篇。
2. 它能被生成吗？（列表、数量、路由、env）能生成就别手写。
3. 属性块填了吗？`rot-if` 写不出具体触发条件，说明这篇还没想清楚边界。
4. `node scripts/docs-check.mjs` 过了吗？
