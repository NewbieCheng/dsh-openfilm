# 0.8.0 方案（v2）：面板显示思考 + OpenFilm 预设的工具/技能白名单

> 状态：待你过目，尚未实现。v2 按你的决定更新：**web_search / web_fetch 保留**；技能只留视频相关；
> 读文档/读文件与跑 openfilm CLI 的工具保留；其它工具禁用。本版把「能力」换成了**真实工具名 + 来源插件**。

## 一、面板与 DSH 是不是存了两份数据

是两份记录，但**同一个数据源**：

| 记录 | 位置 | 谁写 |
|---|---|---|
| 面板对话 | `no996_openfilm_official_chat`（`src/official-chat-store.mjs`） | `chat:save-sessions` / `chat:save-turn`，官方界面 Chat 组件 |
| DSH 会话 | DSH 自己的 Session 存储 | DSH 内核 |

两者都由 `src/official-agent-events.mjs` 把 DSH 的 chunk 翻成 ACP update 后派生，只是渲染格式不同。
0.7.1 的「轨迹」标签（`chat:log`）已经是「原样读我们录下的事件」；要完全以 DSH 为权威，就是下面的阶段 2。

## 二、为什么面板看不到「思考」

上游 `apps/desktop/chat/src/lib/agent-transcript.ts`：

```ts
// L32-33  `thought` / `plan` only come from an agent on the user's machine …: the built-in agent's reasoning is not sent
// L150-152  /* Thinking only drives the status line underneath. */ case 'agent-thinking': return items;
```

而我们的桥确实在发（`src/official-agent-events.mjs` L132 / L199）：`reasoning-delta → agent_thought_chunk`。
所以是**上游不画**，不是数据没到。工具同理被 `lib/agent-activity-runs.ts` 折叠成 `N 个步骤`。

## 三、阶段 1（建议先做）：把思考和工具画进面板

1. `lib/agent-transcript.ts`：`agent-thinking` 收成 `kind:'thought'` 项（带时长），思考结束**保留**为可折叠块，标题 `思考 6s`。
2. `components/ProjectConversation.tsx` + 新 `ThoughtBlock.tsx`：默认收起、点击展开、可复制。
3. `lib/agent-activity-runs.ts`：相邻 act 不再折叠成 `N 个步骤`，每步一行（`已检查影片 · openfilm_film`）。
4. 验收：面板一轮 = 思考块 + 工具逐条 + 正文，与 DSH 侧可对照。

## 四、预设的工具白名单（真实工具名，这是你要过目的部分）

预设是**插件组合**：`cordis.patch.yml` 里装了哪些插件，就有哪些工具（没装 ＝ 不存在，天然白名单）。
下面「来源」是 DSH 的真实插件包 id，「工具名」是模型实际看到的工具。

### 4.1 保留

| 保留的工具名 | 来源插件 | 为什么 |
|---|---|---|
| `read` / `write` / `edit` | `@deepseek-ai/dsh-tool-fs` | **读文件/读文档（含图片 `read_image`）**，让模型能吃各种输入，也是改 `film.html` 的唯一途径 |
| `glob` / `grep` | `@deepseek-ai/dsh-tool-fs-search` | 找文件、找镜头、找关键词 |
| `pwsh`（Windows）/ `bash`（其它） | `@deepseek-ai/dsh-tool-pwsh` / `dsh-tool-bash` | **跑 openfilm CLI**（`node <plugin>/bin/openfilm.mjs doctor|look|render`） |
| `job_list` / `job_output` / `job_kill` | `@deepseek-ai/dsh-tool-jobs` | 渲染/导出要几分钟，必须能后台跑、能收日志 |
| `web_search` / `web_fetch` | `@deepseek-ai/dsh-tool-web` | **按你的要求保留** |
| `todo_write` | `@deepseek-ai/dsh-tool-todo` | 多步剪辑的进度可见 |
| `skill` | `@deepseek-ai/dsh-tool-skill` | 只为视频技能留着（见 4.3 白名单，非视频技能一律不在作用域内） |
| `openfilm_frame` / `openfilm_film` / `openfilm_library` / `openfilm_get` / `openfilm_clip` / `openfilm_assets` / `openfilm_export` / `openfilm_cli` / `openfilm_guide` | 本插件（`dsh-openfilm`） | 影片读、改、导出、规范的唯一通道 |
| `read_image` | `@deepseek-ai/dsh-tool-fs` | 看参考图、封面、抽帧（不保留就等于看不了画面） |

### 4.2 禁用（预设里不装，模型看不到）

| 禁用 | 来源插件 | 理由 |
|---|---|---|
| `codegraph` / `codegraph_index` | 第三方 `codegraph` 工具包 | 剪片不是改代码；索引吃上下文 |
| `subagent` / `subagent_fork` | `@deepseek-ai/dsh-tool-subagent` | 单项目剪辑不需要分身，且容易并发乱改同一个 film.html |
| `send_message` / `interrupt_agent` / `list_agents` | `@deepseek-ai/dsh-tool-subagent-control` | 同上 |
| `create_goal` / `get_goal` / `update_goal` | `@deepseek-ai/dsh-tool-goal` | 剪片用不上，模型会追着设目标 |
| `working_directory` | `@deepseek-ai/dsh-tool-working-directory` | 会话固定是项目目录，改工作目录只会搞错路径 |
| `load_workspace_dependencies` | `@deepseek-ai/dsh-tool-workspace-dependencies` | Office 文档场景用 |
| `present` | `@deepseek-ai/dsh-tool-present` | 交付物由 Studio 面板展示 |
| `ask_user`（确认类工具） | `@deepseek-ai/dsh-tool-ask-user` | 面板已有权限/提问卡，两套会重复问 |
| `terminal_*` | `@deepseek-ai/dsh-tool-terminal` | 剪片不做终端交互；命令走 pwsh/bash |
| `session_query` | `@deepseek-ai/dsh-tool-session-query` | 不应去翻别人的会话 |
| `lsp` | `@deepseek-ai/dsh-tool-lsp` | 剪片没有语言服务器 |
| `schedule` / `workflow` / `ralph` / `cordis` / `testkit` / `str_replace_editor` / `executor-ptc` | 对应 `dsh-tool-*` | 插件开发、工作流、测试用途，与剪片无关 |
| 持久 shell（`bash_persistent` / `pwsh_persistent`） | 对应插件 | 剪片是短命令，进程常驻反而占资源 |
| `codex_image_generate` | 宿主图像工具 | 素材走 `openfilm_assets` + Studio 素材库，避免两套来源 |
| `agy_tool` | Antigravity 桥 | 与本产品无关 |
| `office_*` 技能 | `@deepseek-ai/dsh-skill-office` | 与剪片无关（插件整体不装） |

保留但需确认的一个：`@deepseek-ai/dsh-tool-call-timeout-policy`（超时策略，属治理不是工具）——建议**保留**。

### 4.3 技能白名单（预设作用域）

- 技能目录里**只放我们自己提供的视频技能**（例：`openfilm-editing`：镜头语言、字幕/转场约定、导出档位选择），由本插件随包发布；
- 其余技能（`impeccable`、`frontend-design`、`api-*`、`office-*` 等）在预设作用域内**一律不放行**；
- 视频规范的主体仍由 `openfilm_guide` 工具承担，技能只补充「怎么剪更好看」这类经验；
- 若你希望连技能都不要，就把 `dsh-tool-skill` + `dsh-skill-filesystem` 也从预设去掉，只留 `openfilm_guide`。

**两个落地手段（实现时按 DSH 真实接口二选一，先验证再写）**

| 手段 | 说明 | 状态 |
|---|---|---|
| 不装 `@deepseek-ai/dsh-skill-*`（除 `dsh-skill-filesystem`） | 预设即作用域，没装就看不到技能目录 | 确定可行 |
| 让 `dsh-skill-filesystem` 只扫我们随包发的 `skills/` 目录 | 需要确认它的 config 是否支持指定根目录 | **待验证**（读它的 plugin config schema） |
| `ctx.skills.allow(...)` 白名单 | 我们 facade 里有 `skills.allow` 方法名，但那是**页面代理面**，不等于 Host 侧 API | **待验证** |


## 五、阶段 2（可选，中大）：单一数据源

新增 `chat:transcript` 通道，面板的**读**路径改从 DSH 会话日志取权威事件并映射成面板转录项；面板记录退化为缓存 + 增量写，冲突以 DSH 为准。
好处：思考/工具/todos 只有一份，DSH 升级自动跟上；代价：映射层长期维护，回归面较大。

## 六、验收

- 阶段 1：面板一轮 = 思考块（可展开）+ 工具逐条 + 正文；`tsc -p chat` 通过；`node --test tests/*.test.mjs` 全绿。
- 预设：`/api/no996-openfilm/diagnose.preset` 报出实际装配的工具清单，人工核对与本表一致；
  真实剪辑任务里模型**不再调用**被禁工具；同一句话的轮次耗时与 token 消耗前后各记一次（进 CHANGELOG）。
- 技能：`skill` 列表只剩视频技能（或为空）。
