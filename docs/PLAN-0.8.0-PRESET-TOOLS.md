# 0.8.0 方案（v4）：工具面分层 — 10 个 openfilm_* 与原生 CLI 的关系`n`n> 状态：**已实现（0.8.0，本地，未推送）**。见 CHANGELOG 0.8.0。

> 状态：只规划，未开工。v4 回答两个疑问，并把「工具到底是谁、干什么」讲清楚。

## 一、10 个 openfilm_\* 是「Host 侧能力」，不是 CLI 的包装

先把事实摆出来（都在 `src/*-tool.mjs` 里，`description` 原文可查）：

| 工具 | 真实作用 | 为什么 CLI 干不了 |
|---|---|---|
| `openfilm_film` | 读 **Studio 已解析**的影片：轨道、clip id、时长、锁定标记，外加本机可导出的编码能力 | CLI 只按文件系统解析；「Studio 现在解析成了什么」只有 Studio 知道（面板上看到的就是它） |
| `openfilm_frame` | 用**正在运行的 Studio** 画真实一帧/整条样片，把图片本身返回 | CLI `look` 可以出联系表，但走 ffmpeg 需要下载/安装；Studio 里的画面与面板所见一致 |
| `openfilm_get` | 用人在 Studio 里连过的服务生成素材（配音、音乐、音效、转写、图片、视频） | CLI `get` 只能拿免费库；付费/账号类服务需要 Studio 里的凭据与额度 |
| `openfilm_clip` | 原子改 `film.html`（移动/裁剪/切分），先读 hash 基线、再保存、再校验 | CLI 没有这个动词；这是「安全改片」的实现 |
| `openfilm_assets` | 列出可用文件，或把文件**经 Studio 管线**导入（生成 poster/probe，面板立刻看得见） | CLI 无导入管线；绕过 Studio 会导致面板不刷新 |
| `openfilm_library` | 搜 OpenFilm 内置免费库（转场、特效、滤镜、贴纸、文字样式、音乐、音效、模板） | CLI 没有检索接口，只有 `get` |
| `openfilm_export` | 走 Studio 的导出队列，先读编码能力再排队，可查状态/取消 | CLI `render` 只出 MP4 到 film.html 旁；面板的导出任务、多格式、进度都不在 CLI 里 |
| `openfilm_cli` | 跑**内核 CLI**，只放行三个动词：`doctor` / `look` / `render` | 这就是「不过 shell 直接跑 CLI」的那个：argv 在工具里拼，不经 shell，不会注入 |
| `openfilm_guide` | 读内核随包带的**手册**（剪辑 / 素材 / 画布三章） | CLI 只有 `--help`；手册是给人看的长文，工具负责把它变成上下文 |
| `openfilm_draft` | 在内存里演练一次 `film.html` 编辑，返回结果不落盘 | CLI 没有 dry-run |

**结论**：CLI 是「离线、无界面、批处理」那一层（`open / look / render / get / canvas / skills / skill / update / doctor`，见内核 `bin/openfilm.mjs` 的 USAGE）；工具是「必须在 Studio 进程里做」的那一层（画帧、导出队列、导入素材、连服务生成、原子改片）。**两层都要，不是重复**。

反过来：CLI 能做而工具不做的事，正是 `openfilm_cli` 那三个动词（`doctor` 看这台机器有什么、`look` 出联系表、`render` 出 MP4）——因为这三件不需要 Studio。

## 二、`openfilm-editing` 这个技能：现在**不存在**

我已核对：

- 我们从来没发过 DSH 技能包（仓库里没有任何 `skills/*/SKILL.md`）；
- 现在的剪辑规范放在三处：① `src/openfilm-prompt.mjs` 的系统提示词段；② `openfilm_guide` 工具读的**内核手册**（`node_modules/openfilm/manual/`）；③ 内核 CLI 自带的 `openfilm skills` / `openfilm skill <name>`（它自己就有一套「这部电影能用什么技能」的清单）。

所以「要不要发技能」= 要不要在 DSH 层再包一层。我的建议：**不发**，理由是规范已有三个权威来源，再包一层会和内核手册版本漂移；确实需要时，把内核 `manual/` 里最常用的两章（剪辑 + 素材）变成一个薄技能即可（约 100 行，随包发）。

## 三、预设工具清单（v4 定稿版，等你点头）

### 3.1 装（9 个原生插件 + 10 个影片工具）

| 装什么 | 工具名 |
|---|---|
| `dsh-tool-fs` | `read`、`read_image`、`write`、`edit` |
| `dsh-tool-fs-search` | `glob`、`grep` |
| `dsh-tool-pwsh`（Win）/ `dsh-tool-bash` | `pwsh` / `bash`（跑 CLI、跑脚本） |
| `dsh-tool-jobs` | `job_list`、`job_output`、`job_kill` |
| `dsh-tool-web` | `web_search`、`web_fetch`（你要求保留） |
| `dsh-tool-todo` | `todo_write`（你确认保留） |
| `dsh-tool-skill` + `dsh-skill-filesystem` | `skill`（技能清单本身受作用域限制；若不发技能，这一组可不装） |
| 本插件 | 10 个 `openfilm_*` |
| `dsh-tool-call-timeout-policy` | 治理用（不是工具，保留） |

### 3.2 不装（原生里对剪片无用）

`dsh-tool-goal`、`dsh-tool-subagent`、`dsh-tool-subagent-control`、`dsh-tool-working-directory`、`dsh-tool-workspace-dependencies`、`dsh-tool-present`、`dsh-tool-ask-user`、`dsh-tool-terminal`、`dsh-tool-session-query`、`dsh-tool-lsp`、`dsh-tool-schedule`、`dsh-tool-workflow`、`dsh-tool-ralph`、`dsh-tool-cordis`、`dsh-tool-testkit`、`dsh-tool-str-replace-editor`、`dsh-tool-executor-*`、`dsh-tool-bash-persistent` / `dsh-tool-pwsh-persistent`、`dsh-skill-office`。

### 3.3 第三方：不在清单内，也不写禁用

`codegraph`、`codex_image_generate`、`agy_tool` 等一律不提及。预设只声明自己装什么，别人装什么与它无关——可独立分发、不打架。

## 四、面板显示思考（同一批待做）

- **阶段 1（建议）**：上游转录层把 `agent-thinking` 收成 `kind:'thought'` 可折叠块；相邻工具调用不再折叠成「N 个步骤」。
- **阶段 2（可选）**：`chat:transcript`，面板读 DSH 权威日志，记录退化为缓存。

## 五、等你确认

1. 预设清单（3.1 / 3.2）照此执行？
2. 技能：**不发**（推荐）／发一个薄 `openfilm-editing`／连 `dsh-tool-skill` 都不装？
3. 思考显示：阶段 1 还是阶段 2？

确认后我按 0.8.0 一起做：预设重排 + 面板思考显示 + 文档与测试；推送仍等你发话。
