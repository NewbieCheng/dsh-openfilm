# 0.7.0 规划 v2：完全访问 + CLI 取舍 + 右侧对话成为唯一入口

> 基线：插件 `0.6.1` / 官方 `openfilm@0.3.2`（本轮由 0.3.1 升级，见 §14）。上一版（v1）只讲了"呈现层坏了、能力层缺了"，**没有回答你真正要的三件事**：
> ① 进去就一次授权"完全访问"；② CLI 到底要不要、要不要打包；③ 右侧对话就是唯一的剪辑入口。
> 本版把这三件定成主轴，其余围绕它排期。**先看计划，不动代码。**

---

## 0. 本版相对 v1 改了哪三处

| # | v1 的说法 | v2 的修订 |
|---|---|---|
| 1 | 权限"做不到完全访问，只能折中" | **错。DSH 有 per-session 权限预设**：`permissionPresets.set(session, 'danger-full-access')` 会一次性写入沙箱模式 + 审批策略（`danger-full-access` = 全盘读写 + 不再询问）。插件在会话创建后调它即可，且**在 DSH 里可见可撤销**，不是暗门。 |
| 2 | CLI"全部缺，建议先不复用" | **CLI 已经躺在插件依赖里了**（`package.json` 里 pin 了 `openfilm-0.3.1.tgz`，含 `bin/openfilm.mjs` + `library/` + `manual/`）。所以"下载/打包"这一步**已经完成**，缺的是**启动它 + 让它连我们这份 Studio + 告诉模型它存在**。v2 给出分工与风险。 |
| 3 | 左右两个输入框并存，二选一待定 | **定案：右侧对话是唯一写入口**。左侧照旧可用，但同一会话的并发输入按"插话"处理（不再判冲突失败）。 |

---

## 1. 目标体验（用户视角，只有三条链路）

**链路 A · 一句话出片**
打开视频创作面板 → 选模板或空白草稿 → 首次弹出一次「完全访问」确认（点一下就再也不问）→ 在右侧输入框写一句"把这段素材剪成 30 秒竖版，标题用我的名字" → 右侧逐条显示：`正在读取影片 · film.html` → `正在预览影片 · 第 12 秒`（**并给出真实画面**）→ `正在运行命令 · …` → `已导出 · ~/OpenFilm/xxx/xxx.mp4`。

**链路 B · 我自己的素材**
把 mp4/图片拖进右侧输入框 → 文件落到项目 `assets/upload/`，右侧回一句"已放入素材库" → 一句话"把这个视频放到标题那张图的位置" → agent 用 `openfilm_frame` 前后各看一眼 → 落盘改 `film.html`（最小 diff）。

**链路 C · 我看不懂它在干什么**
任意长任务，右侧必须能回答"现在在第几步、在动哪个文件、卡在等什么"。卡住只有三种合法状态：等模型、等工具、**等你确认**（第 3 种必须显式显示，绝不能再是"一直转圈没动作"）。

---

## 2. 决策一：进入即授权"完全访问"（最优先，0.5–1 天）

### 2.1 能力是真的（不是绕）

DSH 自带权限预设服务 `permissionPresets`，两个内置预设：

| 预设 | sandbox | approval | 含义 |
|---|---|---|---|
| `workspace-write` | 工作区可写 | `ask` | 写项目目录，越界要问 |
| `danger-full-access` | 全盘 | `never` | **全盘读写 + 永不询问** |

写入方式（per-session、durable，写进会话事件 `permission/preset` + `sandbox/mode` + `approval/policy`）：
`ctx.get('permissionPresets').set(session, 'danger-full-access')`（`set` 内部走 `setSandboxMode` / `setApprovalPolicy`）。
出处：`@deepseek-ai/dsh-permission-presets`（`catalog()` / `set()` / `apply()`，默认表就在同文件）。
可见性：DSH 会话里它是一条真实事件，侧栏/会话设置能看到并改回；不是插件私藏的开关。

### 2.2 流程（只问一次，之后不再打扰）

```
面板打开项目
  └─ 已有绑定会话？──否─→ 建会话（此时是 workspace-write + ask）
        │
        ├─ 本项目已授权过？──是─→ 直接用
        │
        └─ 否 → 面板弹「完全访问」卡（一次性）
                文案：「视频剪辑要读写项目文件、跑命令、调 Studio 导出。
                       允许后可无人值守完成整片；风险是它能读写你整个磁盘。
                       [允许并继续]  [只用工作区（每步可能问你）]」
                ├─ 允许 → permissionPresets.set(session,'danger-full-access') + 记一笔（本项目）
                └─ 不用 → 保持 workspace-write（审批走 §2.4 的桥）
```

- 记录位置：新 storageDomain `no996_openfilm_project_permissions`（`{projectId, preset, at}`）。**只记结果，不记凭据。**
- 面板里常驻一个"权限：完全访问 ▾"的小标签，可随时改回 `workspace-write`（改回同样调 `set`）。
- 新建项目/模板项目同样走这套（复用同一函数）。

### 2.3 为什么这样是安全的

- 授权对象是**这一条会话**，不是整个 DSH；会话结束/换项目不继承。
- 授权发生在**用户点过按钮之后**，且按钮文案写明"能读写整个磁盘、不再询问"。
- 我们的工具面仍然只接受**项目 ID + 相对路径**（Host 每次用 Studio 的项目表校验），"完全访问"不等于"模型能随便填路径"。

### 2.4 完全访问模式下审批不再出现，所以审批桥要保留给工作区模式

`danger-full-access` 预设把审批策略设成 `never`（不询问），所以：
- 完全访问：不会有审批卡，也不会再有"卡在等确认"；
- 工作区模式：审批照旧由 DSH 弹。**右侧必须显示**（v1 的审批桥保留，排到 M2），并且左下角状态改为"等你确认"。

> 结论：`§2` 解决"不想被打断"，审批桥解决"选择了工作区时的可解释性"。两者不冲突。

---

## 3. 决策二：CLI 怎么用（已打包，缺的是接线）

### 3.1 现状：CLI 已经在插件依赖里

`package.json` 的 `dependencies.openfilm` 是 pin 死的官方 tarball `openfilm-0.3.1.tgz`，安装插件时它整个进 `node_modules/openfilm/`，包含：
`bin/openfilm.mjs`（CLI）、`studio/`（Studio 服务端 + UI）、`library/`（CC0 动效库）、`manual/`（3 篇手册）。
**所以"把 CLI 下下来打包进插件"= 已经完成**；现在的缺口只有三个：① 谁去执行它（agent 目前没有可调的命令）；② 它连哪个 Studio；③ 模型不知道它存在。

### 3.2 但它比 HTTP 慢且脆——逐项对比

| 用途 | HTTP（我们已起着的 Studio） | CLI `openfilm …` |
|---|---|---|
| 单帧 / 封面 / 页面信息 | `GET /api/projects/:id/media?what=frame|poster|probe`，**零新进程**，几百毫秒 | `look 4.5`：起 node → 找 `~/.openfilm/run.json` → 我们没 advertise → **另起一个 Studio(4747)** → 再起 Chromium → 写 PNG |
| 取动效/转场/贴纸/文字/音乐/音效/模板 | `POST /api/get/library`（含 `take` 复制进项目） | `get transition --prompt … --take x`（同一套实现） |
| 服务商生成（配音/生图/生视频/转写） | `POST /api/get/<verb>` | `get tts/music/…` |
| 导出 | `POST /api/projects/:id/exports` + `GET` 轮询（ffmpeg 在 Studio 进程里跑） | `render`（同样要 ffmpeg，自己驱动） |
| 整片联络表 + 同帧一致性检查 | **无对应路由**（要 N 次 frame 自己比） | `look`（一次出表）+ `look --full` |
| 画布 | `POST /api/canvas` | `canvas apply` |
| 额外成本 | 无 | 第二个 Studio、第二个端口、run.json 争用、首次下载 Chromium（数百 MB）、**子进程需要命名管道（工作区沙箱下会被拒，你已实测）** |

**结论：HTTP 为主，CLI 为辅。** CLI 只保留两个 HTTP 没有等价物的动作用例：
1. `look`（整片联络表 + `--full` 一致性检查）——"逐镜验证"的批量版；
2. `render` 兜底（当 `exports` 路由不可用/版本变化时）。

### 3.3 怎么让 CLI 不另起一个 Studio

CLI 通过 `~/.openfilm/run.json` 找 Studio（`studio/client.mjs`），字段是 `{pid, supervisor?, origin, filmOrigin, key, version?, app?}`。方案：

- 插件启动 Studio 时（`startStudio({port:0, advertise:false})`）**由我们代写 run.json**：`{pid: process.pid, origin, filmOrigin, key, version, app:true}`，写到**我们这个 Studio 实际使用的 home**（上游 `studioHome()`，与我们同一 home 时不额外复制）；
- 关闭时**恢复原文件**（若有）；
- 若该 home 已有 run.json 且指向**另一个活着**的 Studio（用户自己的 OpenFilm 桌面端），**不覆盖**，CLI 交给它用（并提示"你机器上另有一个 OpenFilm 在跑"）。

风险与回退：写 run.json 是我们"代上游"维护一个它自己的文件。回退开关 = 环境变量 `NO996_OPENFILM_CLI=1`（**注意方向**：设 1 表示"本进程不许调 CLI"，此时只有 HTTP 路径，`openfilm_cli` 直接报"本机未启用"；我们给子进程显式设 0，防递归）。

### 3.4 打包与暴露清单

| 项 | 做法 |
|---|---|
| 依赖 | 保持 tarball pin（不换 latest、不额外下载） |
| 暴露 | 新增 Host 工具 `openfilm_cli`（见 §5），只允许 **6 个白名单动词**：`look`、`render`、`get`、`canvas`、`doctor`、`skills`；cwd 强制 = 当前绑定项目目录；`env.OPENFILM_NO_BROWSER=1`；超时 10 分钟；输出截断 8 KB |
| **上下文（关键）** | **模型必须自己知道 CLI 在哪**，见 §5.1：预设提示词里写死解析出来的绝对路径 + 调用规约；不许让模型去猜路径或 `npx` |
| 前置条件 | 只在 `danger-full-access` 模式下可用（否则子进程会被沙箱拒），否则工具回一句"要用 CLI 请切到完全访问" |
| 首次成本 | 首次 `look`/`render` 会下载 Chromium，工具输出必须先说"首次要下载浏览器，可能几分钟" |

### 5.1 预设必须自己带着「CLI 在哪、怎么调」（你点名的那条）

你撞到的原话是"没有可用的 openfilm CLI"——不是没装，是**没人告诉模型它在哪、该怎么调**。三件事缺一不可：

1. **路径由 Host 解析，写进预设提示词**（`src/openfilm-prompt.mjs`，在 Host 进程里 `require.resolve('openfilm/bin/openfilm.mjs')` 后插值，不是占位符、不是让模型去 `which`）：
   ```
   openfilm CLI：node "F:\...\dsh-openfilm\node_modules\openfilm\bin\openfilm.mjs"
   ```
   并要求：**cwd 必须是当前项目目录**，不要 `npx`、不要全局安装、不要换版本（版本 pin 在 `package.json`）。
2. **写清优先级**，否则模型会在三种手段之间乱撞：
   `openfilm_*` 工具（首选）→ `openfilm_cli`（工具不在时）→ 手写 `film.html`（前两者都不可用时；此时必须说明"看不到画面，结果未验证"）。
3. **写清前置与代价**：先 `… doctor` 自检；首次 `look`/`render` 会下载 Chromium；工作区模式下子进程会被沙箱拒（要去完全访问）；`render` 依赖 ffmpeg（缺了就说缺，不许假装导出成功）。

验收：会话的系统提示里能看到**真实绝对路径**；模型能跑通一次 `openfilm doctor`；当 `openfilm_cli` 被关掉时，模型的回答会明确降到"手写 film.html 且看不到画面"，而不是继续假装调用。

---

## 4. 决策三：右侧对话 = 唯一写入口

- 右侧输入框发的每一句 = 一条 DSH 用户消息，进绑定会话；左侧 DSH 输入框不再作为剪辑入口（仍可用于同一会话，但要处理并发）。
- 同一会话的"别人插话"不再判 `OFFICIAL_AGENT_CONFLICT` 让整轮失败：改为**记一条 `notice`（"你在 DSH 侧插了一句，已排队"）并继续跟随**，终态以本轮 `turn/end` 为准。这是当前"发一句就 503/冲突"的根因之一。
- 左侧只读跟随：右侧发出后，左侧能实时看到同一轮的工具与思考——这本来就是 DSH 原生渲染，不用改。

---

## 5. 能力面：六个工具 + 一个兜底（全部 Host → Studio，key 不出 Host）

| 工具 | 后端 | 干什么 | 里程碑 |
|---|---|---|---|
| `openfilm_frame` | HTTP `media?what=frame|poster|probe` | **给模型真画面**：单帧/封面/页面信息；替代"没 CLI 就瞎猜" | M3 |
| `openfilm_film` | HTTP `GET /api/projects/:id` + `…/exports` | 读整部影片解析结果（轨道/片段/时长）+ 能不能导（`can.h264` 等） | M3 |
| `openfilm_library` | HTTP `POST /api/get/library` | 动效库：转场/特效/滤镜/贴纸/文字模板/音乐/音效，`take` 复制进项目并给出要写的行 | M3 |
| `openfilm_get` | HTTP `/api/get/<verb>` | 服务商生成（配音/生图/生视频/转写）；没连服务就明确说"要人在 Studio 里连" | M3 |
| `openfilm_clip` | 本地 `vendor/film-doc.mjs` + 原子写 | **落盘改时间轴**：place/replace/retime/trim/split/静音/轨道标志；带 mtime+hash 冲突检查、锁定轨道拒绝 | M4 |
| `openfilm_export` | HTTP `exports` 起任务 + 轮询 + `reveal` | 导出并给路径；先看 `can` 再承诺 | M5 |
| `openfilm_cli`（兜底） | 子进程 | `look`（整片联络表 / `--full`）、`render` 兜底、`doctor` | M7 |

已有的 `openfilm_guide`（3 篇手册）与 `openfilm_draft`（内存草稿）保留：`draft` 降级为"预演"，`clip` 才是落盘。

---

## 6. 呈现层（v1 的核心发现，保留并前置）

右侧"啥也没有"的可证根因（不改它，后面全白搭）：

1. **动作类型恒 `other`** → 官方壳子把每个工具调用都画成同一句「正在处理」。壳子的词典是 `read/search/edit/execute/fetch` → `正在读取文件/正在运行命令/…`，另有 OpenFilm 专用词表（`openfilm:look` → `正在预览影片`）。我们发 `kind:'other'`，必然塌成一句。
2. **`rawInput` 必须是对象**（壳子从里面取文件名/命令行），我们发了字符串 → 连"动了哪个文件"都取不到。
3. **中间态不画**：`tool_call_update` 只在 completed/failed 时生效，所以要靠"每个新 `tool_call` 一张卡 + `plan`（对接 todo）+ `notice`（里程碑）"来回答"到第几步"。
4. **审批从来没送到右侧**：DSH 用 `approval/request` 瀑布问人，我们没接 → 面板只会"停住不动"。§2.4 的桥补上（也顺带解决工作区模式的观感）。

映射表（M2 落地，纯函数 + 单测）：

| DSH 工具 | 壳子 kind | 显示 |
|---|---|---|
| `read` | `read` + `locations:[{path}]` | 正在读取文件 · film.html |
| `write`/`edit` | `edit` | 正在编辑文件 · … |
| `glob`/`grep` | `search` + `rawInput.pattern` | 正在搜索文件 · … |
| `pwsh`/`bash` | `execute` + `rawInput.command` | 正在运行命令 · … |
| `web_search`/`web_fetch` | `fetch` | 正在搜索网络 / 正在阅读网页 |
| `todo_write` | `plan` | 计划清单（逐项打勾） |
| `openfilm_*` | title 写成 `openfilm:look` 等 | 正在预览影片 / 正在检查影片（OpenFilm 专用词表） |
| 其它 | `other` | 人读标题（至少不是 `tool`） |

---

## 7. 八步计划（每一步解决一个具体问题；顺序即依赖）

> 已按此序列建立 goal，逐轮推进。每步交付：**实现 + 单测 + `docs/TEST-CHECKLIST.md` 里的一节**；真机验证由你执行，你的结论才是那一步的终态。

| # | 这一步解决"你的哪个问题" | 做什么 | 验收（缺一不算） | 天数 |
|---|---|---|---|---|
| **1** | 「右边啥也没有，我不知道它到底跑没跑」——连"事件死在哪一环"都没有证据 | 观测层：DSH 帧 / Host 发出的 envelope / 页面收到并 apply 的计数，三路对齐；`/diagnose` 增加 `bridge` 段；把根因结论写进 `docs/NOTES.md` | 发一句触发 read+pwsh 的话，三处计数与 `kinds` 分布对得上；右侧空白的根因从"推测"变"定论" | 0.5–1 |
| **2** | 「一进模式就到处要权限、还被沙箱拒、跑不动」（你实测 Chrome 起不来、命名管道被拒） | 完全访问：首启一次性确认卡 → `permissionPresets.set(session,'danger-full-access')`；结果记在 `no996_openfilm_project_permissions`；面板常驻"权限：完全访问 ▾"可改回 | 新项目首启只问一次；DSH 侧可见 `danger-full-access`；之后跑命令/起子进程不再被问；改回后恢复询问 | 0.5–1 |
| **3** | 「这个剪辑模式到底用哪个模型、思考强度多高」+「模型不知道 openfilm CLI 在哪、该怎么调」 | 会话预绑定（建项目即绑会话）+ 模型目录来源改为 DSH 实时注册表 + `thinking` 选项（低/中/高，随模型变化）+ 三档自动策略 + **预设提示词注入 CLI 绝对路径、调用规约与手段优先级（§5.1）** | 菜单里能选模型与强度并生效；新项目首句自动落"起稿档"；切模型后强度选项随之刷新；会话系统提示里 CLI 是**真实绝对路径** | 1–2 |
| **4** | 「右边只有一句『正在处理』，看不到思考、看不到在动哪个文件」（你截图的核心痛点） | 呈现层：act 词典（read/edit/search/execute/fetch→中文动作+文件名/命令行）、`rawInput` 改对象、`locations`、`todo_write`→计划清单、里程碑 `notice`、失败/取消态、历史 act 落库 | 真机右侧出现「正在读取文件 · film.html」「正在运行命令 · …」「正在预览影片」等可读行 + 计划清单；失败红色；刷新后历史卡片仍在 | 2–3 |
| **5** | 「要权限的时候右边没显示，一直在卡顿，没有动作了」+「打断不同步」 | 控制层：审批桥（`approval/request`→面板 `permission` 卡 + 可见 `notice`，与 DSH 自己的审批竞速，谁先答谁算）；`turn/end{aborted}` 归一为"已停止"；并发插话不再判 `CONFLICT` | 工作区模式下审批卡在右侧可见且能点；两侧谁先答都生效；DSH 侧停止 → 右侧 3 秒内显示"已停止"而不是错误；左侧插话不再让整轮失败 | 2–3 |
| **6** | 「能不能读右侧的项目资源、画面对不对、能不能用动效库」 | 能力层 A：`openfilm_frame`（真画面：frame/poster/probe）、`openfilm_film`（整片解析 + 能否导出）、`openfilm_library`（CC0 转场/特效/贴纸/文字/音乐/音效 + take）、`openfilm_get`（服务商生成，未连服务如实说） | 模型先渲染一帧再改片；能取一个转场写进 `film.html` 并在 Studio 里看到；未连服务时给的是人话不是报错堆栈 | 2–3 |
| **7** | 「把视频放在图片那个位置这类常用动作得能做」+「我自己上传的视频怎么进素材库」 | 能力层 B：`openfilm_clip`（place/replace/retime/trim/split/轨道标志，原子写 + mtime/hash 冲突检查 + 锁定拒绝）；上传通道按类型分流（图片→参考图，视频→`assets/upload/`）并回"已入素材库 + 可引用的相对路径" | "把这个视频放到标题图的位置"落盘为最小 diff；锁定轨道与冲突被拒且说得清；拖入 mp4 后项目 `assets/upload/` 有文件、Studio 素材面板可见 | 2–3 |
| **8** | 「一句话把片子做出来并导出」+「CLI 要不要装/打包」 | 入口闭环：面板首页（空白草稿 / 选模板）→ 预绑会话 → 首句建议 → `openfilm_export` 导出给路径；CLI 兜底 `openfilm_cli`（只放 look/render/doctor，代管 run.json，`NO996_OPENFILM_CLI=1` 可关，工作区模式明确拒绝） | 链路 A（选模板→一句话→导出 mp4 真实可播）与链路 B（拖视频→替换图片）各走通一次，全程不手写 film.html；`look` 的 PNG 落在项目 `.film/cache/look/` | 3–4 |

**总工作量约 14–21 天。** 第 1–2 步是"能不能跑起来"，第 3–5 步是"能不能看懂、能不能停"，第 6–8 步是"能不能干活、能不能出片"。

---

## 8. 分工与验收（改过两次，以这版为准）

**分工**：
- 我：把 8 步的**代码全部写完并接线**，每步补单测，同步 `docs/DESIGN-0.7.0.md`（设计）与本计划；**不等你测就继续下一步**。
- 你：**最后一次性验收**——我全部交付后，你按 `docs/TEST-CHECKLIST.md` 从头跑一遍，把不对的地方告诉我，我改。

所以：中途不会再有"某步受阻等你验证"的停顿。只有三种情况我会停下来问你：

1. 需要**产品决定**（例如默认是不是完全访问）；
2. 需要**只有你能给的信息**（例如某个服务商 key、你的真实项目路径）；
3. 遇到**无法自证的技术死路**（例如上游路由根本不存在）。

每步"完成"由我这边三条判据定义，缺一不算：

1. 代码已接线（不是"写了但没接"）；`node --test` 相关用例全绿；
2. `docs/TEST-CHECKLIST.md` 里这一节的步骤**我先行自查**（前置条件我确认可用、命令我能跑通到需要人点的那一步）；
3. `docs/DESIGN-0.7.0.md`、`AGENTS.md`、`CHANGELOG.md` 同步更新。

> 唯一例外：**"右侧真的画出来了没有"这一条我无法自证**（我不能看你的浏览器）。所以它会留在清单里等你最后批测，我不会说它"已验证"。

---

## 9. 明确不做（这一版）

- 不接真 Codex/Claude 二进制；不做多智能体 roster。
- 不做"自动配好服务商 key"（生成类素材要人在 Studio → 设置里连）。
- 不在 `danger-full-access` 之外偷偷放宽路径校验；工具永远只认项目 ID + 相对路径。
- 不为了好看伪造工具/审批结果。

---

## 10. 三个决策（已按推荐采纳，2026-11 定）

1. **完全访问的默认值 → 采纳推荐**：首次进入项目即**主动请求一次完全访问**（`danger-full-access`），不先给工作区再追问；面板常驻 chip 可随时改回「只用工作区」，改回后恢复逐次询问。实现见 `src/official-permission.mjs` 与 `assets/shell-ui.js` 的确认卡。
2. **CLI 的定位 → 采纳推荐**：**HTTP 为主**（`openfilm_frame` / `film` / `library` / `get` / `assets` / `export` 全走 Studio 的本地 API），`openfilm_cli` 只留 `doctor` / `look` / `render` 三个动词做兜底；argv 由 Host 自建（不经 shell），cwd 固定项目目录，`NO996_OPENFILM_CLI=1` 可整体关掉。
3. **顺序 → 采纳推荐**：按 M1 → M2 → M3…（先"能用且看得懂"，再补能力）。八步已按此顺序全部交付。

> 若以后要反转第 1 条（默认只用工作区）：改 `src/official-permission.mjs` 的默认预设 + 面板文案即可，不动工具层。若反转第 2 条（CLI 成为主路径）：`openfilm_cli` 的白名单动词放开到 `get`/`canvas`，其余工具保留作为失败兜底。

---

## 11. 当时"写好但没接线"的代码（现已全部接入）

这一节记的是决策前的状态，保留作为过程记录：`src/frame-tool.mjs` 与 `src/official-approval-bridge.mjs` 当时都没挂到 `studio-controller`，行为为零。**现在两者都已接线**（分别在第 6 步、第 5 步），配套改动（`official-approvals.mjs` 的 `answerRequest`/`onRequest`、`official-agent-service.mjs` 的 `activeKey`、`official-chat-rpc.mjs` 的 `agent:answer-permission`、`official-facade.mjs` 的真实 `answerPermission`）也一并生效。所以当初的 (a)/(b) 选择已经由结局回答：选了 (a)。

---

## 12. 证据索引

| 事实 | 位置 |
|---|---|
| `danger-full-access` = 全盘 + 永不询问；`set(session, name)` 是 durable 写路径 | `@deepseek-ai/dsh-permission-presets/lib/types/index.js`（`presets` 默认表、`set()`、`apply()`） |
| `createSession` 没有权限字段，所以必须建后 `set` | `@deepseek-ai/dsh-api-session-controller/lib/index.js:235` |
| DSH 的审批是瀑布事件 `approval/request`，answerer 用 `ctx.on(...)` 注册（ACP 桥是现成范例） | `@deepseek-ai/dsh-acp/lib/index.js:1093`、`@deepseek-ai/dsh-user-approval` |
| `reasoningEffort` 可随 `selectModel` 一起设 | `@deepseek-ai/dsh-api-session-controller/lib/index.js:704-724` |
| CLI 的 Studio 发现方式与 run.json 字段 | `node_modules/openfilm/studio/client.mjs`（`Running` 类型、`health()`） |
| 我们起 Studio 时 `advertise:false`、自带 home | `src/studio-runtime.mjs:100` |
| 单帧/封面/页面信息路由 | `node_modules/openfilm/studio/server/server.mjs:1043-1085` |
| 导出队列与编码能力 | 同文件 `1088-1119`；`exports.mjs` 的 `exportCapabilities()` |
| 内置动效库搜索/take | 同文件 `349`、`425`；`get.mjs` 的 `library` 路由 |
| 官方壳子的动作词典（`t7`/`e7`/`ZAe`、中文文案） | `vendor/official-shell/ui/assets/index-1YHCuSgq.js` @2521839、@2448704、@2501883 |
| 我们的工具事件恒 `kind:'other'`、`rawInput` 是字符串 | `src/official-agent-events.mjs:49-59` |

---

## 13. 执行完成情况（2026-11 本轮）

八步的**代码、单测、文档**全部落地；真机验收按 §8 由你最后统一跑一遍 `docs/TEST-CHECKLIST.md`。

| # | 代码 | 单测 | 清单 | 与计划的偏差 |
|---|---|---|---|---|
| 1 | `bridge-trace.mjs`、`studio-controller` 的 `/diagnose.bridge`、facade 上报 | `bridge-trace.test.mjs` 7 条 | §1 | 无 |
| 2 | `official-permission.mjs` + `agent:permission*` 双通道 + `assets/shell-ui.js` 确认卡/chip | `official-permission.test.mjs` 13 条 | §2 | 无 |
| 3 | `official-thinking.mjs`、`official-turn-policy.mjs`、`openfilm-prompt` 注入 CLI 绝对路径 | 7 + 5 条 | §3 | 模型/强度菜单复用 DSH 现有选择器，未新造 UI |
| 4 | `tool-call-act.mjs` + `official-agent-events` 的 kind/rawInput/locations/plan | 10 + 事件测试 | §4 | `todo_write`→`plan` 而非独立卡片 |
| 5 | `official-approvals.mjs` + `official-approval-bridge.mjs` + `aborted`→cancelled + 插话改 `notice` | 7 + 2 条 | §5 | 只接管"本项目当前轮"，其它一律原样 `next()` |
| 6 | `studio-http.mjs`（唯一出口）、`frame-tool`、`film-tool`、`library-tool`、`get-tool` | 8 + 9 条 | §6 | **关键发现**：上游 `media` 路由对页面也支持 `frame`，因此不需要本机 Chrome/CLI |
| 7 | `clip-tool.mjs`（hash 基线 + 写前二次比对 + 原子 rename）、`assets-tool.mjs`（走 Studio 导入管线） | 9 + 7 条 | §7 | 上传不在 Host 侧另造一套，统一走 `PUT /api/projects/:id/files` |
| 8 | `export-tool.mjs`（先读 `can`）、`cli-tool.mjs`（三动词 + argv 自建 + 双向递归保护）、首句即开工的预设措辞 | 10 条 | §8 | `openfilm_cli` 只放 doctor/look/render；`get/canvas` 一律走工具 |

**测试**：`node --test tests/*.test.mjs` → 307 项，306 通过、1 跳过、0 失败。

**仍未由自动化覆盖、留给真机的三件事**：①事件是否真的到达页面（`/diagnose.bridge.panel.seen` 与 `accepted` 的差值）；②审批卡在官方壳里是否被真正渲染（`notice` 是保底可见路径）；③导出后文件是否真的可播。

---

## 14. 内核升级：openfilm 0.3.1 → 0.3.2

上游在 2026-11-09 发布了 0.3.2（我们此前 pin 的是 11-08 的 0.3.1）。按"只动内核、不动界面快照"的方式升级：

| 面 | 结论 | 依据 |
|---|---|---|
| `studio/server/websocket.mjs`、`http.mjs` | **零改动** | `diff` 无差异；我们代理的"不分片 JSON 帧 + ping 控制"假设仍成立 |
| `bin/openfilm.mjs`、`src/library-search.mjs` | **逐字节相同** | `openfilm_cli` 的三个动词与库搜索行为不变 |
| `studio/server/server.mjs` | 增量：项目 `duplicate`、文件变更 `notifyReferences`、复合片段 `wave`；`canvasWriteRoute` 多收一个 `project.path` | 我们用的 `GET /api/projects/:id`、`/files` GET/PUT、`/media?what=`、`/exports`、`/api/get*` 路由签名未变 |
| `pageframes.mjs` | 新增 `compoundSound` 导出，`pageFrame` 签名不变 | `openfilm_frame` 的 `what=frame|poster|probe` 不受影响 |
| `exports.mjs` | 新增剪映/CapCut 草稿、HEVC alpha、媒体引用收集；`ExportAsk` 既有字段未删 | `openfilm_export` 用白名单拷字段，新字段自然忽略 |
| `get.mjs` | 只改 `AskAgent` typedef（多了 model/images） | `openfilm_get` 调用面不变 |
| `studio/ui/dist` | 重建过（打包哈希变了） | **不影响我们**：面板服务的是 `vendor/official-shell` 快照，不是 `node_modules` 的 UI |
| `vendor/official-shell` | **保持 0.3.1** | 重建需上游 git checkout 到 `a85a80a…` 且要预构建产物；改的是 DOM/CSS，必须真机验收后再做 |

落点：`package.json` 依赖改为 `openfilm-0.3.2.tgz`，`src/studio-runtime.mjs` 的版本比对与 `/api/health` 校验自动跟到 0.3.2；`assets/shell-ui.js` 关于页面的兜底版本号同步；全库 323 项测试（322 通过 / 1 跳过）在 0.3.2 下通过，其中 `template-registration.test.mjs` 会真正拉起随包 Studio。

**留给真机的确认**：面板仍由 0.3.1 界面 + 0.3.2 服务端组成，需按 `docs/TEST-CHECKLIST.md` 跑一遍确认无协议错配（重点：预览播放、画帧、导出）。