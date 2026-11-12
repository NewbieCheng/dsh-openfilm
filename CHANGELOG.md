# 更新记录

## 0.13.0 —— 侧栏保持原生：撤销全部工作区定制

- **侧栏不做任何改动**：不占用 `sidebar.workspaces`、不加行按钮、不往会话菜单加项、不往视图菜单加筛选、不改样式、不隐藏行。置顶、归档、拖拽、运行中状态、右键菜单全部是 DSH 原版行为。
- 删除的代码（连同测试一起）：`src/project-filter.mjs`（视图菜单「工作区类型」注入与生成式筛选样式）、`src/area-store.mjs`、`src/area-client.mjs`、`src/area-view.mjs`、`src/area-route.mjs`（只读的 `/api/no996-openfilm/area`）、`project-conversation.bindings()`，以及 `studio-entry.js` 里对应的 store / 菜单 / 诊断上报接线。
- 保留且不涉及侧栏的能力：视频创作面板（`main` + 一个 `sidebar.panellist` 入口 + `shell.overlay` 常驻）、Host 反向代理与对话桥、`no996-openfilm:navigate` 父页面 → iframe 导航、只读诊断 `POST /api/no996-openfilm/diagnose`、`GET /__dsh/...` 诊断端点。
- 保留的基础设施修复：所有本地路由经 `registerRoute`（函数声明、重复注册降级为警告、注册失败回滚），避免管理开关重复 apply 或残留路径时插件整体激活失败；`client-log` 复用已有路由，不重复注册。
- 桌面端启动修复：面板在 `dsh-app://app` 下改为走 Host 的 `/api/no996-openfilm/bootstrap`（桌面壳会把该请求连同宿主 cookie 转发给 Host），本地调试 console（47821）只在兜底时使用。之前桌面端直接读 console，而 console 只有在调试窗口开过 Studio 之后才知道地址，所以稳定 503。
- 回归测试：`tests/sidebar-untouched.test.mjs` 断言源码里不再出现 `sidebar.workspaces`、`session.row.action`、`contextMenus`、`viewOptionsMenu`、`data-row-key`、`hiddenSessionIds`，且五个已删模块不再存在；`tests/route-registration-order.test.mjs` 断言路由守卫是函数声明且只有它直接调用注册表。
## 0.12.1 —— 本地服务 SenseVoice 改回原生渲染

- 撤掉 `assets/shell-ui.js` 里往「本地服务」弹窗追加卡片的 B2 注入，改为改上游源码数据：`studio/server/local-models.mjs` 的 `ABOUT` 加一条 `sensevoice-small`，`library/local-models.json` 加模型文件清单。UI 完全由这份数据驱动，所以 SenseVoice 现在作为「语音转写」组里的普通一行渲染（名称 / FunAudioLLM · 228 MB / 安装 / 原生进度条 / 已开启），没有额外卡片。
- 这两处都在安装后的 `openfilm` 包里，pnpm 重装会覆盖，所以 Host 每次启动幂等重放（`src/studio-library-patch.mjs`），重装后不会丢。
- 模型文件仍走国内源：Host 起一个回环 library 镜像（`src/studio-library-mirror.mjs`），把 Studio 的 `OPENFILM_LIBRARY_URL` 指过去——SenseVoice 的两个文件从 hf-mirror 流式转发（失败回退 huggingface.co），Whisper / BiRefNet 302 回 `openfilm.dev/library`，不做全量镜像。
- 模型仓合一：`asr-models` 现在直接读写 Studio 的 library 缓存 `~/.openfilm/library/models/sensevoice-small`（`OPENFILM_LIBRARY_CACHE` 可覆盖），并写 Studio 的 `.ok` 标记，所以原生面板和对话里的转写工具永远看到同一份文件、同一个“已安装”状态。
- 新增测试：补丁幂等（`tests/studio-library-patch.test.mjs`）、镜像转发与 302（`tests/studio-library-mirror.test.mjs`）、缓存路径（`tests/asr-models.test.mjs`）。
- 说明：上游源码用 `npm run upstream:fetch` 拉（pin `758b1a3`，checkout 在 `.upstream/openfilm`）；`fetch` 子命令对 pin 的 commit 用 `git fetch <sha>` 会失败，但对象已在 clone 里，直接 `git checkout <sha>` 即可。

## 0.12.0 —— 本地服务：镜像、进度、SenseVoice

- 已安装检测：`resolveAny` 依次看打包依赖 → 我们下载的 `tools/` → Homebrew / WinGet / scoop / chocolatey 目录；Host 启动时把 `/opt/homebrew/bin`、`/usr/local/bin`、WinGet Links 前置进本进程 PATH。Mac 从 Finder 启动不再"已装却没检测到"。
- 下载镜像：ffmpeg/ffprobe 先走 npmmirror、失败回退 GitHub/npm；SenseVoice 先走 hf-mirror、失败回退 huggingface.co；`NO996_OPENFILM_ASR_BASE_URL` 仍可整体覆盖。连接 20 秒超时即换源。
- 进度可见：`system:check` / `asr:status` 新增 `phase / source / speed / attempt / error`；首启向导显示"正在连接下载源 → 下载 12.3/75 MB · 1.2 MB/s（源：npmmirror）→ 校验中"，失败原因可读，"重试安装"不再卡在"正在开始…"。
- 本地服务面板：设置 → 服务 → 本地服务里追加一行 **SenseVoice · 本地转写**，安装/进度/就绪都走 `asr:*` 通道，与对话里的转写工具是同一个模型（B2 注入，已登记 UI-PLAYBOOK）。
- 说明：ModelScope 没有 sherpa-onnx 布局的 SenseVoice 仓库（实测 404），暂不列为源；hf-mirror 对 `resolve` 是 308 到 HF CDN，仍作为首选并在失败时回退。
- 新增 `tests/download-sources.test.mjs`；`tool-installer` 增加换源、`resolveAny`、下载后检测的测试。

## 0.11.3 —— 项目对话真正坐进项目工作区

- 根因：DSH 0.11 的 `workspace/create` 返回 `{ workspace: { workspaceId, sessionIds }, created }`，插件按旧的扁平 `id` 读，永远拿不到 id（日志里每次打开项目都是 `WORKSPACE_CREATE_NO_ID`），于是退回 `cwd` 建会话；而 DSH 把一个会话算进工作区只认 `workspace.sessionIds`（`SessionSummary` 上没有 `workspaceId`），所以每个项目的对话都落在「未分组」。
- 修复：按真实契约解包（旧扁平形状继续兼容）；新会话一律带 `workspaceId` 创建；创建后回读 `workspace.sessionIds` 当作归组证据，不再依赖并不存在的 `attachSession`。
- 存量：绑定的会话还在但工作区不认领时——空会话（`blank`）换一条归组的新会话，旧会话原样保留；有历史绝不自动换绑，只在日志报 `WORKSPACE_SESSION_UNGROUPED`。
- 诊断：`workspace-join` 带 `step`/`code`；换绑记 `project-conversation-rebound`（旧会话 → 新会话）；同一条件每个项目只报一次。
- 测试：`tests/project-conversation.test.mjs` 改成真实返回形状，覆盖旧扁平兼容、回读归组、未确认不重试、有历史不换绑、空会话归位、catalog 不可读不重复建。
- 边界：DSH 没有"把已有会话塞进工作区"的 API，非空的旧会话只能留在未分组；Host 代码要重启 DSH 才生效（管理器返回 `restart-required`），重启后的真机归组待复测。

## 0.11.2 —— Mac 上的删除文案

- 删除失败的提示按平台区分：只有 Windows 说"被 DSH 会话或文件监视占用"；macOS 说"检查访达完全磁盘访问，或关闭仍在使用它的程序"；其他平台给通用说法。
- 说明：macOS 移入废纸篓走 `/usr/bin/trash` 或 `~/.Trash` 的 `rename`，POSIX 允许对仍被打开/监视的目录做 rename，所以 Windows 那类"目录被监视就删不掉"在 Mac 上不成立；删除前停对话的归档仍然保留（项目要删了，对话不该继续跑）。
- 仅文案与注释，无行为变化。

## 0.11.1 —— 删除项目的报错与占用

- 删除项目不再把整段 `Command failed: powershell.exe …` 和 stderr 弹给用户：代理把这一类 5xx 改写成 409 + 一句人话（文件夹被谁占用、下一步怎么办），失败原文只留在诊断日志里。
- 删除前先归档该项目绑定的对话（`stopActivity`），释放它作为 DSH 工作区对项目目录的文件监视；归档失败不影响删除继续。
- 新增 `tests/proxy-error-sanitize.test.mjs`：原始命令失败被替换、普通 5xx 原样透传、归档先于转发。
- 边界：409 只保证错误可读、不被壳当 5xx 重试；目录被其他进程占用时仍需先关掉占用方，真实 GUI 删除未复测。

## 0.11.0 —— 自有品牌与样式产线

- 文档收敛：`AGENTS.md` 28.9 KB → 9.1 KB；删除 `HANDOVER.md`×2、`PROGRESS.md`、`HOT-RELOAD.md` 与 4 份已实现/被取代的 `计划-*`；新增 `docs/UI-PLAYBOOK.md`（改哪一层）、`docs/UPSTREAM.md`（补丁与升级）、`docs/BRAND.md`（品牌边界）。
- 样式产线：`assets/theme/{tokens,shell,studio}.css` + `src/theme.mjs`（surface 注册表、mtime 缓存、`NO996_OPENFILM_THEME=0` 关断）；代理与 47821 调试窗口按页面注入；发版前 `npm run shell:bake` 把同一份 CSS 烘焙进 `vendor/official-shell/ui` 并重算 manifest。
- 样式工作台：`assets/style-lab.js`（Shadow DOM，点选元素、显示选择器/计算样式、复制改动说明），仅 `NO996_OPENFILM_STYLE_LAB=1` 时注入。
- 上游补丁系列化：`patches/` 一个源文件一个补丁 + `series.json`；`scripts/upstream.mjs` 提供 `status / fetch / verify / shell:dev`；`npm run patches:check` 校验系列与 `patch.diff` 一致。
- 品牌层：`brand/brand.json` + `src/brand.mjs`（校验、`--n996-*` 变量、归属声明不可缺）+ `npm run brand:check`。
- 新增命令：`dev:styles`、`docs:check`、`brand:check`、`patches:split`、`patches:check`、`upstream:status|fetch|verify`、`shell:dev`、`shell:bake`。
- 新增测试：theme、brand、style-lab、theme-bake、theme-injection、upstream/patch-series、docs-check。

## 0.10.0

**首次启动引导与开发者模式**

- 组件检测不再随页面加载自动探测：`assets/shell-ui.js` 只在 `__no996CheckTools()`、`no996-check-tools` 事件或首次启动向导里检查，正常进入工作台不再弹右下角提示。
- 首次启动向导（`prefs.onboardingCompleted !== true` 时出现）：第 1 步列 ffmpeg/ffprobe/转写模型，缺的组件直接给出状态并自动开始下载转写模型（走 `asr:install` 桥通道），第 2 步选片型（四个模板 + 自定义）。
- 自定义画布与时长落进 prefs（`customRatio` / `customSeconds`），非法值拒绝；`project:create-blank` 会保存并回传。
- 开发者模式：`NO996_OPENFILM_DEV=1` 时 `createWorkbenchAuth` 返回本地 `dev@local` 会话（不写 token、不连账号服务），账号条显示「开发模式」并隐藏退出按钮。
- 新增桥通道 `asr:status` / `asr:install`；注入层不再直连 `/api`。
- `ffprobe-static` 进可选依赖；组件探测优先用随包的 `ffmpeg-static` / `ffprobe-static`（按 basename 认版本），装齐的机器第一次启动就是就绪状态，不再依赖 PATH。
- 新增 `src/tool-installer.mjs`：随包缺二进制时下载 ffmpeg（GitHub release）或 ffmpeg-static/ffprobe-static 包内二进制，写进 `$DSH_HOME/no996-openfilm/tools`，带进度、错误与单飞重试。
- Host 新增 `POST /api/no996-openfilm/system/check` 与 `/system/install`，同一份装配也走 `system:check` / `system:install` 桥通道；向导据此显示下载百分比与「重试安装」。
- 修代理白名单：`system:check` / `system:install` / `asr:status` / `asr:install` 在还没有项目时不要求项目作用域（此前被 `authorizeOfficialProject` 判 403，真机上向导只能走回退路径）；补了回归测试。
- 向导自定义项新增语言（中文/English），与画布、时长一起存进 prefs；两页按钮统一右下角、主动作最右。（未发布）—— 本地口播转写

> 本版包含 0.9.1 尚未发布的那一批（登录迁进官方壳等），以本节为准。

### 改：片型选择面板 Film Bay 工位感

注入「模板」弹窗与官方 `OnboardingGate` 统一：台面加宽至约 1080、**一行等分片型轨**（不够才微横滑）、登录条同款点阵纸感 + Ember 顶线/内光、海军底 + 橙踢脚「用这个开工」；去掉蓝 CTA 与 4+1 残缺网格。

### 新：官方壳第一步引导（Batch O1）+ AI 剪辑员工栏头/空态（Batch O2）

本机首次进创作台先选片型（口播讲堂 / 知识大赏 / 手绘笔记 / 自定义空白），完成后不再挡路；会话栏可「重新选片型」。右侧对话定位为 **AI 剪辑员工**（栏头、空态、拖放提示）。实现进官方 chat 源码 + `vendor/official-shell`，不是 DOM 注入主路径。

- Host：`$DSH_HOME/no996-openfilm/preferences.json`；RPC `prefs:get` / `prefs:set`；`template:list` 带产品名与 prefs；`template:create` / `project:create-blank` 写偏好并返回 `onboarding` 文案载荷。
- 上游 O1：`OnboardingGate` 全壳遮罩。
- 上游 O2：栏头 `AI 剪辑员工`；空态职责文案 + 虚线拖放提示；拖入时 Ember 描边；占位符改「说主题/拖素材」。
- 补丁文件 **17 → 19**（新增 `OnboardingGate.tsx`，改 `ProjectStarters.tsx`）。
- 真机验收仍待。界面口径见 `docs/UI-PLAYBOOK.md`，批次状态见 `docs/ROADMAP.md`。

### 新：`openfilm_transcribe`，把口播视频变成带时间码的文稿

Host 侧新增一个工具：给一个本机视频/音频路径，返回逐段时间码 + 全文，**全程本机 CPU、不上传**。SenseVoice-small int8（sherpa-onnx Node 绑定）+ ffmpeg 抽 16 kHz 单声道 + RMS 能量切段；权重首次使用时下载 228 MB 到 `$DSH_HOME/no996-openfilm/models`，之后只读本地。

- 首次调用自动开始下载且**不阻塞这一轮**：`status` 看进度、`setup` 手动触发、面板/控制台可 `POST /api/no996-openfilm/asr`、命令行 `node scripts/asr-models.mjs fetch`；下载写 `.part` 再改名并校验大小与 sha256。
- 两个样本实测（Windows 11 / Node 24.20 / 纯 CPU）：5.632 s 音轨 **RTF 0.085**（含 1.55 s 一次性模型加载）；19.176 s、三处静音间隔 → **3 段，RTF 0.039**，段界与静音吻合；二次调用命中缓存 **2 ms** 返回。
- 默认由会话模型校对同音字与专名，**时间码不变**；返回长度不符或请求失败时保留原文并写明原因（`refine: false` 可关）。
- 无音轨 / 超 3 小时 / 全静音 / 空结果各有独立失败码，拒绝发生在抽 PCM 之前；视频不进 Node 堆，音频按段读取。

> 源码 + 单测（63 项新增）+ 真机引擎已验证；**macOS 与面板一键安装按钮未验证**。详见 `docs/TRANSCRIBE.md`。
### 新：动效生产协议 + 动作库 + 风格/镜头卡素材库

- `docs/MOTION.md`：七道闸门（接单→分镜→**定调帧**→量产→声音→帧检→交付）与完成契约；新增 skill `openfilm-motion`；预设系统提示明确「闸门之间不停机、导出并回读输出才算完成」。
- `vendor/templates/_kit/motion/motion.js`：闭式阻尼弹簧（zeta 0.61 ≈ 9% 过冲）、落体挤压、确定性随机（禁 `Math.random`）、相机/取逆、擦除、逐字、滚数、2× 画布与颗粒；构建时发到各模板 `assets/motion.js`，`Scene.motion` 暴露给镜头脚本。**旧 19 镜默认值不变**。
- 收录 `vendor/motion/styles`（14 种风格，MIT，含 brief/prompt/样片）与 `vendor/motion/shotcards`（124 张镜头卡，Apache-2.0，含 recipe）；索引 `docs/STYLES.md`、`docs/SHOT-CARDS.md`。样片的上游依赖（node_modules/three/film.js）在索引里逐条注明，**不声称自包含**。
- 测试：动作库数学/确定性 6 项；协议与素材库 9 项；官方 film 解析器覆盖 `motion-styles`。
- 登录首页改版：换成纸张打卡卡 + 底部「一天」时间轴，背景用 01 扁平矢量样片的城市与公交（`scripts/build-login-city.mjs` 生成 `assets/login-city.js`）。时间轴默认播放、可暂停/拖动；暂停时背景一起冻结；`prefers-reduced-motion` 下默认暂停。天色随 9:00→18:00 从亮到暖再到深蓝星空，走完一天切黑淡入下一天。
- 登录页的太阳改成会走的日/月：沿弧线从东（右）升到西（左）落，傍晚太阳淡出、月亮淡入；样片内置的固定太阳与光芒在挂载后移除。
- 登录页性能：背景 30fps + 半分辨率栅格化、天色合成到一层渐变（不再叠 5 层全屏 opacity）、页面隐藏时停画、时间轴指针改 `transform`、文字只在分钟/分段变化时写入、去掉播放钮的 `backdrop-filter`。无头 Chromium 验证：2.5 秒内 151 帧、p95 16.7ms、无 long task；自动播放 09:11→09:15、暂停后 09:15 不变、注册态字段与登录验证码弹层正常。
- 新增模板 `motion-styles`（1920×1080），两种镜头来源（Studio 级已验：临时 home 装模板 → `openProject` → `GET /api/projects/:id/media?what=frame` 出图，t=2 与 t=15.5 均正常）：
  - 直封上游样片：01 扁平矢量（内联 cues、去外部字体、`window.film` 契约、视口缩放）；
  - 按 brief 重写：02 包豪斯（`shot-02.scene.html`，用 `Motion` 的弹簧/错峰/擦除/滚数/相机）。
  - 无头 Chromium 抽帧 t=2/5.5/6 无报错，同 t 两次渲染字节一致；修掉父层非整数缩放导致的文字条带接缝（`will-change: transform`）。
  - 真实 GUI 已验：官方 shell 的片型选择器列出「动效风格样片」；Studio 编辑器打开该项目，时间轴为 shot-01 10s + shot-02 8s，画布 1920×1080。脚本 `frame:page` / `frame:studio` / `studio:ui`。

## 0.9.1（未发布）

### 修：启用失败 `duplicate exact route "/api/no996-openfilm/templates"`

**根因**：DSH `webServer.register` 每次只收一条路由；`client-log` 与 `bootstrap` 曾被塞进同一次调用（第二条被忽略），且装配中途抛错时已注册的 `/api/no996-openfilm/templates` 不会回滚，再次启用就撞车。

**修法**：两条路由分开注册；所有 exact 路由纳入 `trackRoute`，失败即 `rollbackRoutes`；dispose 同步先卸路由再关 Studio。

### 改：登录迁进官方壳，紧凑遮罩 + 白 logo

面板不再单独占一整页 React 登录。`assets/shell-login.js` 注入官方 iframe：左上角白 logo、缩小纸张与时间线，矮高度自动收起 timeline，避免遮挡 DSH 内容。账号条仍在顶栏；退出只重开壳内遮罩，不拆 Studio。

### 修：产物链接不再把系统浏览器带进 `OF_SESSION_REQUIRED`

**现象**：对话里的「成片 `手绘笔记-….mp4`」一点，系统浏览器打开 `127.0.0.1:47822/projects/…mp4`，同时报「无法打开 OpenFilm 工作台 (OF_SESSION_REQUIRED)」。项目素材、音乐、说明文档的链接同理。

**根因**：助手写的是项目相对路径（`<手绘笔记-….mp4>`、`<assets/notebook.js>`）。官方聊天把这类链接按页面地址解析到编辑器源，再由桌面外壳交给系统浏览器；而那个浏览器没有面板会话 cookie，代理当然拒绝。不是 OpenFilm 内核的 bug，是「把项目内路径当成网页地址」这条链路。

**修法**：`assets/shell-ui.js` 在页面捕获这类点击，改为向 Host 发一次打开请求；Host 用 Studio 的项目列表验明项目、把路径限制在项目目录内，再交给操作系统的默认应用（Shift/Alt 点击 = 在文件夹中定位）。新增 `POST /__dsh/open-file`（见 `src/studio-proxy.mjs`）与 `src/project-files.mjs`。

### 修：截图路径在对话里直接出图，可点开大图

**现象**：`![私域运营 · 逐帧接触表](<.film/cache/look/….png>)` 在官方聊天里只显示成一截蓝色链接，看不到图。

**根因（两条叠加）**：0.9.0 的内联图片补丁只把**空标签**的 `![](url)` 当作图片，带文字的还是链接；就算标签为空，相对路径也会被解析成 `/projects/….png`，Studio 并不提供这个地址。

**修法**：新增 `GET /__dsh/project-file?projectId=…&path=…`，只读已登记项目里的位图（限 24 MiB、禁 SVG），由页面把图片画在链接旁边；点击打开大图浮层，可「用默认应用打开 / 在文件夹中显示」。已渲染出来但地址失效的 `<img>` 也会被改写到同一路由。

> 源码与单测已验证；真实 GUI 验收（面板刷新后点产物、看截图）尚未完成，按 `docs/TEST-CHECKLIST.md` 复核。

## 0.9.0

### 新：工具调用显示真名

以前每一步都只有闭集文案（「已检查影片」），看不出到底调了什么。现在 `agent-act` 事件带 `tool`，行上多一个等宽小标：`已检查影片 · openfilm_film`、`搜索网页「获客运营」· web_search`。工具名来自桥接侧的 `tool_call.toolName`，上游只负责显示，不再猜。

### 新：对话里直接出现真图片

模型抽的帧、出的联系表，以前只留在附件里，面板上看不到。现在：

- Markdown 支持 `![](url)`（空标签就是一张图，此前被当成非法链接丢掉），渲染成最大高 420px、可点击放大的图片；
- `tool/result` 与 `assistant/message` 文本里出现 `sha256:<64hex>` 时，桥接自动补一行 `![](/api/no996-openfilm/attachment?id=<hex>)`；
- 新增 `GET /api/no996-openfilm/attachment?id=<64hex>`：只认 64 位十六进制、只读 `<DSH_HOME>/attachments/v1/objects/<前2位>/`、按魔数给 MIME、要求 DSH 浏览器同源身份。

### 改：空的「思考 0s」不再出现

没有文本的思考块直接不建行（此前会留一个只有计时器的空壳）。有思考文本时仍默认展开。

### 改：底部按钮只说「模型 · 思考强度」

`自动（按这一句话的内容）` 这类长括号说明被剥掉，只剩 `自动`，模型名不再被挤成 `D…`。

### 修：调工具不再弹出独立的剪辑浏览器窗口

**根因**：`openfilm_cli` 启动内核 CLI 时没设 `OPENFILM_NO_BROWSER=1`；而 CLI 的 `look` / `render` 在项目缺少 `.film/opened` 时会调 `open(project)` —— 那正是"启动 Studio 并在人的浏览器里打开"。于是每调一次工具就弹一个剪辑窗口，里面还带着上游桌面端的引流。

**修法（三层）**：

- 环境变量固定 `OPENFILM_NO_BROWSER=1`（内核自己的开关）；
- 绑定项目时由 Host 写 `.film/opened` 标记（与内核写的空文件一致），CLI 判定"已经展示过"，不再启动 Studio；
- `openfilm_cli` 只保留 `doctor`；`look` / `render` 按名字拒绝并指向 `openfilm_frame` / `openfilm_export`（它们走 HTTP，不启窗口）。

### 修：会话又跑进「未分组」

**根因**：`project-conversation.mjs` 里 `workspaceController` 取不到、`create` 抛错、`attachSession` 不存在或失败，四处 `catch` 全静默，失败即退回 `cwd` 分支 —— 那条分支必然未分组。

**修法**：

- 每一步都记 `workspace-join { step, ok, code }`，不再静默；
- 建完用 `sessionController.list()` **复验** `item.workspaceId`，不成立才 attach，再复验，**最多重试一次**（循环只会对着同一个答案空转）；
- 两次仍不成立 → 标记 `degraded`，项目照常打开（这是展示问题，不是工作阻塞）；
- 已存在的会话每次打开都会重新 seat，之前漏挂的会自己归位。

### 新：诊断能回答「为什么面板是空的」

`/api/no996-openfilm/diagnose` 现在按项目返回最近 4 轮：每种帧收到几个、产出几条更新、哪些帧在翻译层被丢弃，并给一句判词 —— `no-turn-recorded` / `no-frames-received`（DSH 没产出）/ `nothing-emitted`（我们丢了）/ `some-frames-dropped` / `emitted`；同时带 `grouping`（`seated` / `degraded`）。

### 测试与快照

- 新增 `tests/project-markers.test.mjs`（4 例）、`project-conversation` 增 3 例、`export-cli-tool` 增 2 例、`official-agent-service` 增 1 例；全库 **358 项 / 357 通过 / 1 跳过**。
- 上游补丁从 15 个文件增至 **17 个**（新增 `packages/shared/src/markdown-blocks.ts`、`apps/desktop/chat/src/components/Markdown.tsx`），`vendor/official-shell/patch.diff`、`manifest.patch.files` 与之一致。

### 文档

- 新增 `docs/HANDOVER.md`（接手第一站，0.11 起并入 `docs/DEVELOPMENT.md`）、`docs/ROADMAP.md`（一份路线图，不再按版本碎片化；0.9.1 定为账号与登录）；
- 重写 `docs/DEVELOPMENT.md`（25KB → 14KB，事实更新到 0.9.0）；
- 删除 10 份已实现的过期计划文档（`PLAN-0.4.0`、`PLAN-0.5.0`、`PLAN-0.7.0-AGENT`、`DESIGN-0.7.0`、`AGENT-CHAT-PLAN`、`PLAN-0.8.0 ×2`、`PLAN-0.9.0 ×2`、`DISCUSS-0.10.0`），决策历史仍在 `docs/NOTES.md`。

### 升级提示

Host 侧改动需要**重启 DSH**；界面刷新用 Ctrl+Shift+R 即可。旧会话的归属会在下次打开项目时自愈。

## 0.8.2

### 修：预设装坏了 → 每句话都 `PROJECT_CONVERSATION_CREATE`，权限行也消失

**现象**：发一句话就红条 —— `[503] PROJECT_CONVERSATION_CREATE (agent:prompt)`；同时输入框上面的菜单只剩「模型 / 思考强度」，**权限那一行不见了**。

**根因**：0.8.0 我把 `@deepseek-ai/dsh-skill`（技能**注册表**）写进了预设的插件清单，而它本来就由宿主挂载；重复挂载让整个 `openfilm-video-editing` 预设**加载失败**。于是：

- `sessionController.create({ agentPreset: 'openfilm-video-editing' })` 被拒绝 → `createSession` 抛错 → 我们把它压成 `PROJECT_CONVERSATION_CREATE`，真实原因被吞掉；
- 预设不可用 ⇒ 权限状态也取不到 ⇒ `agent:permission` 失败 ⇒ 权限行按"猜不出就不画"的旧策略直接消失。

**修法**：

- `cordis.patch.yml`：移除重复的 `@deepseek-ai/dsh-skill`，并去掉 `skill-filesystem` 上显式写的 `includeDefaultRoots` / `watch`（默认值本来就是我们要的，写出来是第二种弄坏预设的方式）；
- `project-conversation.mjs`：`createSession` 不再吞原因 —— 错误上带 `cause` 与 `detail`（Host 的错误码或消息尾巴，无路径），并写日志 `project-conversation-create`。下次预设装坏，一眼能看到是哪一步；
- `official-facade.mjs`：权限行改成"**永远画出来**"。Host 报的 `current` 不在已知两项里时，把它作为第三个选项原样列出，而不是整行消失。
- 测试：新增两例（预设装坏时 `PROJECT_CONVERSATION_CREATE` 保留 `detail` / `cause` 且不写提示；未知 `current` 仍画出权限行）。

## 0.8.1

### 修：面板弹 `[HTTP 503] OFFICIAL_CHAT_UNAVAILABLE (agent:thinking)`

这是一个**可选菜单**把整块面板拖下水的 bug，由三件事叠出来：

1. 面板每次开合、每轮结束都会顺手问一句 `agent:thinking`（只为「思考强度」菜单选项）。
2. Host 侧 `official-chat-rpc.mjs` 里这个分支原来是 `if (… && typeof agent?.thinkingOption === 'function') return await agent.thinkingOption(…)`，**一旦 Host 那时答不上来（项目还没验证完、会话正在跑），异常就落到底部 `catch`，被统一压成 `OFFICIAL_CHAT_UNAVAILABLE`**。
3. 页面里的抓取包装对所有 5xx 都弹红色横幅，于是"一个没人打开的菜单"变成一条红条。

修法：

- `agent:thinking` 改为**可选面**：Host 答不上来就返回 `null`，把真实原因写进插件日志（`agent-thinking-unavailable`），菜单只剩已有行，操作不受影响。
- 底部 `catch` 不再把所有错误压平：`OFFICIAL_AGENT_*` / `OFFICIAL_CHAT_*` 这类我们自己的错误码原样透出（只透码，不带路径和栈），下次 503 就能直接看出原因。
- 页面里的抓取包装对**可选通道**（`agent:thinking`、`agent:models`、`agent:permission`、`agent:trace`、`chat:archive-state`、`chat:log`）不再弹横幅，只留给真正失败的操作。
- 测试：`tests/official-chat-rpc.test.mjs` 新增三例（降级为 null 且记日志、正常时照旧返回、自有错误码原样透出）。

## 0.8.0

### 面板里看得见思考（第四处上游改动）

- 上游转录层原来把思考丢掉：`agent-transcript.ts` 里 `case 'agent-thinking': return items;`（注释写着「只驱动下面的状态行」），`local-agent-run.ts` 里 `agent_thought_chunk` 直接被压成 `{ type: 'agent-thinking' }`，文本丢了。
- 现在整条链路都通了：`packages/shared/src/contract.ts` 给 `agent-thinking` 加可选 `turnNo` / `partId` / `text`；`local-agent-run.ts` 把推理文本带出来；`agent-transcript.ts` 合成 `kind:'thought'` 的行，并在下一个非思考事件到来时收尾（算出「思考了几秒」）；`AgentActivityRow.tsx` 的 `ThoughtRow` 默认展开、带 `data-thought`，流式中显示"正在思考…"。
- 工具调用保持"包装"形态：相邻动作仍折叠成一张摘要卡（`已检查影片 ×2 · 写文件`），点开才是逐条。
- 测试：`tests/kernel-shell-match.test.mjs` 断言补丁里四处链路齐全、`data-thought` 与 `agent_thought_chunk` 都在。

### 预设工具白名单（只装原生 + 我们的影片工具）

- `cordis.patch.yml` 明确成一份白名单：`dsh-tool-fs`（`read`/`read_image`/`write`/`edit`）、`dsh-tool-fs-search`（`glob`/`grep`）、`dsh-tool-pwsh`/`dsh-tool-bash`、`dsh-tool-jobs`、`dsh-tool-web`（`web_search`/`web_fetch` 保留）、`dsh-tool-todo`、`dsh-tool-skill` + `dsh-skill-filesystem`，其余原生插件不装，第三方工具**一律不提及**（别人装什么都与这个预设无关）。
- 工具面从 29+ 收敛到 23 个：原生 13 + 影片 10（`openfilm_film` / `frame` / `get` / `clip` / `assets` / `library` / `export` / `cli` / `guide` / `draft`）。
- `openfilm_cli` 仍只放行 `doctor` / `look` / `render` 三个动词；`pwsh`/`bash` 保留，用来跑内核 CLI 的其余场景。

### 随包发一个视频技能

- 新增 `skills/openfilm-editing/SKILL.md`：镜头与节奏、转场用法、字幕断句、声音响度、导出档位、风格清单、红线。命令与文件格式仍以 `openfilm_guide` 为准，技能只补「怎么剪好看」。
- 新增 `scripts/install-skills.mjs`：把 `skills/` 镜像到 `<DSH_HOME>/skills`（`--print` 预演、`--force` 覆盖、默认不碰你手改过的副本）。`dsh-skill-filesystem` 会 watch 这个根，所以**加完技能不用重启**。
- 以后要加「设计风格」类技能：往 `skills/` 放一个 `<名字>/SKILL.md`（frontmatter 要有 `name`、`description`），跑一次脚本即可。
- 测试：新增 `tests/install-skills.test.mjs`（三例：安装 + 不覆盖手改 + 缺 frontmatter 拒装）。

### 数字

- 全库测试 **344 项，343 通过 / 1 跳过 / 0 失败**；上游 `tsc -p chat` 通过；界面快照补丁现在 **15 个文件**（`patch.diff` / `manifest.patch.files` 一一对应）。

## 0.7.7

### 会话可以删除了（第三处上游改动）

- 对话列表的每一行现在多一个垃圾桶按钮（`data-session-delete`），归档的行同样有：**两次点击才真的删**，第一次按钮变红并提示"再点一次删除"，4 秒不点自动复位；会话正在跑的时候按钮禁用。
- 删除做的是真删除：`lib/chat-store.ts` 新增 `deleteChatSession()`，把会话从列表里去掉、同时把 `turns` 里属于它的每一轮一起丢掉，然后走原有的 `saveSessions` 写回；Host 侧 `official-chat-store.saveSessions` 本来就会剪掉"列表里已不存在的会话"的轮次，所以磁盘上也不会留下孤儿记录。
- 删的是当前正在看的那条时，自动建一条新的空对话接上；`last` 指向它的话一并清空。
- 顺带说明 DSH 侧的边界：`sessionController` 的服务清单里**没有 delete**（有 list/create/rename/fork/prompt/cancel/archive 那一套，删除会话只有 ACP 层的 `session/delete` 给 agent 用），所以"删掉 DSH 会话"这件事 DSH 本身不提供；我们删的是面板里这条对话及其全部轮次，DSH 那条按项目共享的会话不受影响。
- 测试：新增 `tests/official-chat-store-delete.test.mjs`（保存后列表里没有的会话，其轮次被剪掉并落盘）。

## 0.7.6

### 搜索框真的能搜了；返回按钮删掉

- **搜索框点不动的原因**：输入框上带了 `onMouseDown={keepFocus}`，而 `keepFocus` 的实现就是 `e.preventDefault()` —— 它本来是为了"点菜单别让输入框失焦"，套在输入框自己身上就变成"永远拿不到光标"。现在去掉，加了 `autoFocus`、`spellCheck=false`，并把按键的 `stopPropagation` 保留（避免聊天层的全局快捷键把字母吃掉）。
- **返回按钮删掉**：标题栏只留层名（`data-agent-option-level-label`）。回退改成 `Escape`：捕获阶段拦下并把 `stopImmediatePropagation()` 打在最前面，所以第一次 Esc 回到上一层，第二次才关整个菜单；选中某项仍然自动返回。
- 上游 `tsc -p chat` 通过；全库 340 项 339 通过 1 跳过。

## 0.7.5

### 菜单只认点击，模型列表能搜

- **鼠标划过不再进二级面板**：上一版把 `onMouseEnter` 一起搬了过来，于是指针扫过「思考强度」就直接切成选项层，扫过下一行又跟着换。现在只有 `onClick` 进层，悬停只做行高亮。
- **模型顶部有搜索框**：`data-agent-search`，按名字不区分大小写过滤，无匹配给一句提示；切到别的层时自动清空，不会把新列表藏起来。只要有超过 8 个选项或这一行是模型，就出现搜索框。
- 占位文案进了五个语言包（`composer.searchModel` / `composer.searchNoMatch`：中/英/西/日/韩），不是硬编码中文。
- 打包白名单相应扩到 7 个文件（2 个组件 + 5 个语言包），`patch.diff` 与 `manifest.patch.files` 一致；测试改为逐文件校验 diff 里真有 `b/<path>`。
- 上游 `tsc -p chat` 通过；全库 340 项 339 通过 1 跳过。

## 0.7.4

### 模型菜单改成"点进去一层"（第二处上游改动）

- 上游 `ModelPopover.tsx` 是**悬停/点击在右边弹出大面板**：算位置、把卡片左移让位、窗口窄时卡片缩到半宽（`sideStyle` / `cardShift` / `SIDE_MIN_W` / `SIDE_GAP` / 120ms 关闭计时器）。用你的话说就是"右边直接弹出一大块"。
- 现在改成一次只显示一层：点「思考强度」→ 标题栏变成 `← 思考强度`，下面是选项列表；选中即生效并**返回上一层**；点 `←` 直接返回。
- 选项列表有固定最大高度（`min(58vh, 380px)`）且**可滚动**，所以模型列表再长也不会撑破屏幕（就是你要的"有一定高度可以滚轮"）。
- 侧面板的整条链路（测量、卡片位移、端口渲染、`chatLayer`、`createPortal`）全部删除，卡片不再左右移动。
- 选模型的图标、`data-agent-choice` 标记、禁用态与勾选都保留；`data-agent-option-level` 标注当前层，便于排查。
- 打包白名单从一处扩到两处（`agent-menu-rows.ts` + `ModelPopover.tsx`），`patch.diff` 与 `manifest.patch.files` 同步更新，测试校验补丁内容含 `data-agent-option-level`。
- 上游 `tsc -p chat` 通过；全库 340 项 339 通过 1 跳过。

## 0.7.3

### 一个项目 = 一个工作区 = 一条对话

- **工作区归属**：项目打开时先 `workspaceController.create({ path })`（对已存在的目录幂等），会话用 `workspaceId` 建（`workspaceId` 与 `cwd` 互斥），并补一次 `attachSession`。之前只给会话 `cwd`、不注册工作区，DSH 侧边栏就把它们全放在「无工作区 / 未分组」下面。
- **重开不再新建会话**：`sessionExists()` 原来用 `path.resolve(item.cwd) !== projectPath` 比较，Windows 上同一目录大小写不同（`F:\Dev\X` vs `f:\dev\x`）就判成"不是这个项目的"，于是每次打开都造一条新的空会话——那些「新建会话」就是这么来的。现在按平台归一化后再比，并且工作区成员身份也算归属证明。
- **会话有名字**：新建后 `sessionController.rename({ sessionId, title })` 用项目文件夹名命名；已有标题（包括人自己改的）不动，重开时只补空标题。
- 以上三步都是尽力而为：没有 `workspaceController` 的 profile 仍然能打开项目，只是分组退化成 DSH 原来的样子。
- 测试：新增 `tests/project-conversation.test.mjs` 7 项（工作区注册/命名、重开复用、大小写、无控制器退化、工作区视图形态、外来会话不认领）。

## 0.7.2

### 权限搬进了模型菜单（唯一一处上游改动）

- 上游 `menuOptions()` 只渲染 `model` / `thought_level` / `speed` 三类，别的 `category` 一律丢弃；所以把权限做成 configOption 也画不出来。
- 现在改的是上游前端源码：`apps/desktop/chat/src/lib/agent-menu-rows.ts` 增加一行 `category === 'permission'` 的行（`pick(..., 2)`，没有真实选择就不画）。
- 打包脚本允许且只允许这一处改动（`PATCHED` 白名单），并把 diff 写进快照 `vendor/official-shell/patch.diff`，`manifest.json` 里新增 `patch.files`；其它任何 tracked 改动仍然拒绝打包。
- facade 的 `probe()` 与 `localAgents.start()` 现在都会请求 `agent:permission` 并发布 `permission` 选项；`setOption('permission', …)` 走宿主 `agent:permission-set`。
- 悬浮的权限胶囊整块删除（含 CSS/卡片），它原来盖在时间线上；`tests/shell-ui-asi.test.mjs` 随之改为"没有 body 时不报错、也不写 `<html>`"。
- 后果要知道：界面快照不再与上游逐字节相同，升级内核/界面时要重新应用这处补丁（`patch.diff` 就是补丁本体）。

## 0.7.1

发布包同时升级内核与界面快照：`openfilm 0.3.1 → 0.3.2`。

**UI 打通（三条）**：

- **思考强度真正生效**：菜单行由 `category` 决定，OpenFilm 只渲染 `model` / `thought_level` / `speed` 三种（`apps/desktop/chat/src/lib/agent-menu-rows.ts`）。我们原来发的 `category: 'thinking'` 根本不会被渲染，页面上那个「思考强度 · 默认」是上游内置的固定占位行。改成 `thought_level` 后，行里就是 DSH 声明的各档（外加「自动（按这一句话的内容）」）；`localAgents.start` 的 `configOptions` 也补上思考选项，首条消息前就能选。
- **权限胶囊不再压在画面上**：从底部居中（压着时间轴）挪到右下角，仍在聊天列一侧，随时可改回工作区。
- **屏蔽「已更新 / 有哪些新内容」弹窗**：上游用 Studio prefs 的 `seenVersion` 控制（`components/WhatsNew.tsx`），只要它落后于当前版本就弹。Host 启动后把该值写到 `9999.0.0` 并记 `whats-new-suppressed`，之后任何一次插件升级都不再弹；这是唯一一处会写 Studio 自身偏好设置的改动。
- **「轨迹」不再空着**：面板每轮回复下有一个「轨迹」入口，它读 `app.chat.log` —— 而我们一直把这个通道 `denied`，所以点开什么都没有。现在 Host 把发给面板的每个事件按 `project + turn` 记下来（每轮留最后 2000 条，每项目留最近 4 轮），`chat:log` 按 TurnLog 的契约返回，于是这一轮调了哪些工具、参数是什么、返回了什么，都能逐条看到。
- **归档会话时的 `[HTTP 503] /__dsh/official-rpc`**：桥的并发闸门是 4 个在途请求；归档会让面板同时发起 `chat:load`、`agent:permission`、`localAgents.start`（内部还有 `agent:models` + `agent:thinking`）、`client:log`，一下就撞上闸门。闸门放到 6，撞上时记 `official-rpc-busy`；RPC 失败现在也记 `official-rpc-failed {channel, code}`，并把通道名放进 503 body —— 页面那条红条从 `[HTTP 503] /__dsh/official-rpc` 变成 `[HTTP 503] /__dsh/official-rpc - OFFICIAL_RPC_FAILED (chat:load)`，能直接看出是哪个通道。




**内核升级完成：openfilm 0.3.1 → 0.3.2**。上游 2026-11-09 发布。第一次只升内核被挡回来：`resolveOfficialShell()` 要求内核与 `vendor/official-shell` 快照同版本（manifest 的 version/commit + 每个 `ui/` 文件的 sha256），不匹配就抛 `OFFICIAL_SHELL_UNAVAILABLE`，连锁是 Studio 起不来 → 面板 503 → 项目会话建不起来 → 九个项目工具从会话消失。第二次从上游 tag `v0.3.2`（commit `758b1a3`）浅克隆、`pnpm --filter @openfilm/desktop build:shell` 构建桌面壳、用 `scripts/build-official-shell.mjs` 重建快照，然后内核与快照一起到 0.3.2：`resolveOfficialShell()` 通过、Studio `/api/health` 报 0.3.2、`GET /` 返回新壳页面、注入脚本依赖的 `data-app-menu` / `role="menuitem"` / `of-chat` / `data-studio` / `#root` 全部仍在。接口面逐文件比对为增量兼容（websocket/http 零改动，CLI 与库搜索逐字节相同，`film-doc.mjs` 与 0.3.2 相同故无需更新）。留下两道防线：`tests/kernel-shell-match.test.mjs`（pin 与快照版本不等即失败）与 `studio-warm-failed`/`bootstrap-failed` 记录真实错误码（含 `OFFICIAL_SHELL_UNAVAILABLE`，面板 503 body 也带码）。重建流程写在 `docs/PLAN-0.7.0-AGENT.md` §14.3。

**修复（第二次加载即暴露）**：注入脚本在 `<head>` 里执行，此时 `document.body` 还是 `null`，`permissionGate` 的 `mount()` 直接 `body.appendChild` 抛 `Cannot read properties of null (reading 'appendChild')`，后续注入全部中断。改为「没有 body 就等 `DOMContentLoaded` 再挂载」，并给三处 `createTreeWalker(document.body…)` 加了 `||document.documentElement` 兜底；`tests/shell-ui-asi.test.mjs` 增加 head-only 场景（body=null 时不抛、收到 DOMContentLoaded 后正常挂载），并用「改回旧写法」的反向控制证明能复现原报错。

验证：324 项测试，323 通过、1 跳过（真实 GUI 验收清单见 `docs/TEST-CHECKLIST.md`，最后统一跑一次）。
## 0.7.0

**目标：让「一句话剪片」真的走得通——八步，每步对着一个用户能看见的问题。**

| 步 | 之前的样子 | 现在 |
|---|---|---|
| 1 观测 | 右边空了只能靠猜 | `/diagnose.bridge` 给出 emitted/accepted/refused/kinds + 页面 seen，三路可对 |
| 2 完全访问 | 每一步都被审批卡住 | 进项目一次性授权 `danger-full-access`，面板可随时改回 |
| 3 模型/思考强度 | 只能用默认 | 模型来自 DSH 实时注册表，思考强度是一等选项，空闲时自动降档；预设提示词带 CLI 绝对路径与调用规约 |
| 4 呈现 | 全部「正在处理」 | act 词典：读取/搜索/修改/执行/抓取/思考各有中文标签、文件名、命令；`todo_write` 变成计划清单 |
| 5 审批/打断 | 右边看不到审批、打断报错、插话直接失败 | 审批卡出现在右侧且两侧都能答（后到者失效）；`aborted` 一律显示"已停止"；别人插话只发提示 |
| 6 看得到 | 只能凭 film.html 猜 | `openfilm_frame`（Studio 自己画帧）/`openfilm_film`/`openfilm_library`/`openfilm_get` |
| 7 落盘 | 不敢让它改文件 | `openfilm_clip` 原子写：hash 基线、写前二次比对、锁定轨道拒绝、最小 diff；`openfilm_assets` 走 Studio 导入管线 |
| 8 出片 | 承诺了却不知道有没有文件 | `openfilm_export` 先读编码能力再排队，结果只认 `status` 里的 outputs；`openfilm_cli` 只开 doctor/look/render，argv 自建 |

新增模块：`studio-http`（唯一上游出口，错误信息给 key 打码）、`clip-tool`、`assets-tool`、`export-tool`、`cli-tool`、`film-tool`、`library-tool`、`get-tool`、`frame-tool`、`official-approvals`、`official-approval-bridge`、`official-permission`、`official-thinking`、`official-turn-policy`、`tool-call-act`、`bridge-trace`。

**修复（首次安装即暴露）**：`openfilm_frame` 的输出 schema 把 `required` 写成了属性级布尔（`attachmentId: { type: 'string', required: true }`），DSH 的加载期校验据此判"not supported on type string"，整个插件显示「异常」。已改为对象级数组，并新增 `tests/tool-schema.test.mjs`（11 条）对**全部 10 个工具**的 `parameters`/`output.schema` 做加载期等价校验，这类错误以后在单测阶段就挡住。

**修复（插件真正加载后暴露）**：`assets/shell-ui.js` 里新加的 `permissionGate` IIFE 前面漏了分号，前一条语句以 `})()` 结尾，被 ASI 连成 `})(…)` 调用链，页面抛 `(intermediate value)… is not a function`，整段注入脚本失效。已补 `;`，并新增 `tests/shell-ui-asi.test.mjs`：用假 DOM **真正执行**注入脚本、检查"括号开头接在调用链后"的静态形态、并用同一份 harness 复现原报错作为反向控制。页面脚本按 mtime 读盘，改完强刷即可，无需重启。

## 0.6.1

- Studio 失联时探测实际服务状态，清理旧代理后支持重新启动；面板在后续页面导航无响应时提供诊断和重试。
- 优化模板入口：模板卡片并排显示，选择面板展示模板说明，视频复刻入口暂时禁用但保留原有逻辑。
- 增加启动及健康状态诊断日志，继续避免记录密钥和票据。
- 分发包纳入 `assets/`，并打包 OpenFilm、Zod 及其运行依赖，无需用户单独安装 OpenFilm；Node.js 要求为 22.2 及以上。
- 发布包在 Windows 临时目录中完成 npm 离线安装及 Studio 启动探测；macOS/Linux 安装与 GUI 尚未实机验证。

验证：193 项测试，192 通过、1 跳过；断线恢复及最新布局尚待真实 GUI 验证。

## 0.6.0

**三个模板拆成可复用的素材库（`vendor/templates/_kit/`）**

模板不再是三份手写页面，而是「数据 + 素材单元」构建出来的产物：

| 模板 | 现在的样子 |
|---|---|
| `paper-texture` | 两个镜头共用 8 个单元 + 一份 `assets/kit.css`，差异只剩 7 个 CSS 变量 |
| `replica-film` | 19 个镜头各是一份 `shots/<id>.json`（内容）+ `.content.html`（画面块）+ `.anim.js`（动效）；页面外壳、`COPY`、`DURATION`、`mount` 装配全部由构建器生成 |
| `sketchnote` | 七个页面由窗口数据生成；模型是「一场戏 + 七个时间窗」，窗口连续性有测试 |

新增：

- `_kit/catalog.json`：18 个单元的机器可读目录（槽位、变量、说明），人和模型读同一份；
- `_kit/render.mjs`：槽位填充（`{{x}}` 转义 / `{{{x}}}` 原样）、`{{#if}}` 可选块、`repeat` 重复块、单元样式合并；
- `scripts/templates-build.mjs`：`npm run templates:build` / `templates:check`；
- `docs/TEMPLATES.md`：怎么改文案、加单元、加镜头，以及三个模板各自的模型差异。

顺带修掉两个会静默出错的地方：

- **镜头墙是生成的**：`at` 与 `#t=` 由镜头时长累加得出，不会再与镜头自己的 `duration` 对不上（以前对不上时影片照播，只是内容错位）；
- **模板目录自包含**：安装模板是整目录复制进项目，页面里指向 `_kit/` 的 `../..` 链接在项目里会 404。共享样式改为构建时合并成 `<模板>/assets/kit.css`，并有测试扫描每个页面的 `href`/`src`。

验证（`tests/templates-kit.test.mjs`，58 项）：

- 纸纹讲堂逐镜头比对**标记**与**每个选择器最终生效的声明**（含变量代入）；
- 复刻影片逐镜头比对内容片段、`COPY`、`draw()`，并检查动画用的每个选择器都能在内容里找到；
- 手绘笔记逐镜头比对时间窗与脚本装配，另校验七个窗口首尾相接；
- 每个模板：页面只引用模板目录内部的资源、提交的页面与 `shots` 源一致。

**测试**：186 项 / 185 通过 / 1 跳过。

## 0.5.8

- 导航日志里的 `session` 字段撞上脱敏规则（键名含 session），改成 `authed`，否则日志永远只剩 `[redacted]`。

## 0.5.7

**桌面窗口里工作台白屏（CSP 拦掉了 iframe）**

- 现象：面板不再 404，但显示「官方界面 20 秒内没有回应」，右侧一块纯白。
- 原因：票据页和编辑器页的 `content-security-policy: frame-ancestors <DSH 的 http 源> 'self'` 不允许 `dsh-app://app` 当祖先，Chrome 直接把 iframe 拦掉——里面的脚本一行都没跑，所以既没有票据兑换也没有 boot 消息。
- 修复：`frame-ancestors` 改为「DSH 源 + 任意回环端口 + `dsh-app:` / `app:`」。远程站点仍然框不进来。
- 证据：日志出现 `nav /__dsh/open` → `ticket-redeemed` → `nav / authed:true`。

## 0.5.6

- 代理记录**文档级导航**（`nav`：路由、`sec-fetch-dest`、是否带会话）。白屏这类问题第一步就是看浏览器到底请求了什么。

## 0.5.5

**桌面窗口是 `dsh-app://app`，相对 `/api/...` 根本到不了 Host**

- 现象：面板一直 `HTTP 404`，重启插件无效。
- 原因：桌面端用自定义协议加载界面，`fetch('/api/no996-openfilm/bootstrap')` 被解析成 `dsh-app://app/api/...`，由协议处理器回答 404（它只认自己的 `/api/file`、`/api/plugin`）。服务端路由其实一直是好的（`curl` 打 61088 返回 401＝路由在）。
- 修复：自定义协议下不再走相对路径，改从回环控制台 `GET http://127.0.0.1:47821/api/studio-url` 取 `{origin, ticket}`（不需要凭据、只返回一次性票据，`Access-Control-Allow-Origin: *`）。
- 同时：预设诊断 / 健康轮询 / 归档查询在自定义协议页面下不再发出（它们同样会 404）。

## 0.5.4

- 启动失败的错误信息带上**页面来源**：`HTTP 404 @ dsh-app://app`。正是这一行定位了上面那个 bug——没有它只能靠猜。

## 0.5.3

- 面板遇到 `404/503` 时先**静默重试两次**（1.2 秒间隔）再报错。插件重载有几百毫秒路由空窗，原来这段时间的请求会把面板卡在错误页上。

## 0.5.2

**注入 UI 拆成独立文件，热更新只要刷新**

- `src/shell-extras.mjs` 只剩一个读取器，真正的脚本在 `assets/shell-ui.js`，**每次页面渲染读盘**（mtime 缓存）。
- 结果：改注入 UI → 保存 → 刷新页面，不需要 build、不需要重载插件（实测同一装配下注入内容 44430 → 44450 字节）。
- 新增 `npm run dev`：监听客户端源码自动 rebuild；监听 `src/*.mjs` 自动 **touch 整个 Host 模块图**（加载器只重新求值 mtime 变了的模块，未被 touch 的引入方会继续用旧 import）。
- 教程：`docs/DEVELOPMENT.md` §8（0.11 起合并原 `HOT-RELOAD.md`）。

## 0.5.1

- `ticket-redeemed` 的会话计数改名为 `active`——原来的 `sessions` 被脱敏规则吞成 `[redacted]`。

## 0.5.0

**统一运行日志：崩溃与异常都能事后查**

- 新增 `src/plugin-log.mjs`：JSON Lines、**脱敏**、**轮转**（512 KB，保留 1 个旧文件）、内存里保留最近 200 条。
- 落点：`%TEMP%\dsh-openfilm\plugin.log`。上游 5xx 的原始响应体仍在 `%TEMP%\dsh-openfilm-errors.jsonl`。
- 记录什么：`host-start`（版本/端口/模式）、`studio-warm`/`studio-warm-failed`（含耗时）、`host-stop`（存活时长）、`ticket-minted`/`ticket-redeemed`、`upstream-5xx`（方法/路径/状态）、`upstream-error`（连接失败原因）、以及页面侧事件 `page-recovery-shown`/`page-restart-click`。
- 不记录什么：密钥、票据、cookie、会话 ID、项目绝对路径与名称——这些字段一律替换成 `[redacted]` 或 10 位摘要+长度。
- `POST /api/no996-openfilm/diagnose` 现在带回 `log.file` 与最近 12 条（`log.tail`），面板静默时贴出来的那段 JSON 就自带历史。
- 页面侧事件只接受 4 个固定枚举，经 `official-rpc` 的 `client:log` 通道上报，不接收任意文本。

**测试**：125 项 / 124 通过 / 1 跳过。

## 0.4.12

**点「重新启动工作台」后白屏**

- 现象：卡片上的按钮 → `47821/editor` → 票据页 → `/`，最后停在**纯白页**。
- 原因：票据换出的会话 cookie 只在**桌面**代理上被认可；网页代理只认 DSH 的登录 cookie。票据页把浏览器带到网页代理的 `/`，于是被 403 拒绝，而拒绝响应的 body 是**空的**，所以是一张白纸。
- 修复：会话 cookie 在两个入口都认（它仍然只能由 Host 签发的一次性票据换出，HttpOnly、30 分钟）。同时，被拒绝的**文档级导航**现在返回一段可读文字，指向 `http://127.0.0.1:47821/editor`，不再有空白页。
- 实测：`/editor` 302 → 票据页 200 → 兑换 204 → `GET /` **200**（43 KB 工作台页面）。

**测试**：121 项 / 120 通过 / 1 跳过。

## 0.4.11

**内置浏览器里 `window.__dshEsSetShortcut is not a function`**

- 来源不是本插件：`dsh-element-source-plus` 会对它找到的每个 webview 执行 `window.__dshEsSetShortcut(...)`，而它自己的注入脚本此时还没进这个页面，于是每次都抛一个未捕获的 TypeError。
- 处理：注入脚本在页面最早的位置放一个**同名空实现**（`return false`）。该插件随后真正注入时会直接覆盖它，功能不受影响；只是不再往控制台吐错误。
- 没碰对方的代码，也没改官方 shell。

**测试**：121 项 / 120 通过 / 1 跳过。

## 0.4.10

**页面自己能重启：不再只有官方那句“退出并重新打开应用”**

- Studio 断开（插件重载、服务崩溃、会话过期）时，官方页面顶部只给一句“退出并重新打开 OpenFilm 应用即可恢复”——那是**桌面应用**的说法，用户只看到这个页面，根本无法照做。
- 现在注入脚本每 5 秒探一次 `/api/version`，**连续两次失败**才盖一层卡片：「工作台已停止运行 / 重新启动工作台」。按钮指向固定的回环控制台 `http://127.0.0.1:47821/editor`，它现场签发一次性票据并重新拉起服务，项目和素材不动。
- 只失败一次不打扰（网络抖动不算故障）；恢复后卡片自动消失。

**测试**：120 项 / 119 通过 / 1 跳过。

## 0.4.7

**编辑器端口开机即在，不再等第一次 bootstrap**

- 之前 `47822` 只在第一次 `bootstrap` 之后才监听；直接打开这个地址（或照文档粘贴）会得到 `ERR_CONNECTION_REFUSED`，看起来像插件坏了。现在插件装配时会预热一次 Studio 并建立代理，端口始终可用。
- `↗` 按钮申请到的一次性票据同时写入剪贴板：弹窗被拦截时可以手动粘贴到任意浏览器（不需要 DSH cookie）。
- 预热失败不影响使用，面板仍按原来的惰性路径启动。

**测试**：119 项 / 118 通过 / 1 跳过。

## 0.4.6

**模板下拉挂到对话栏表头；新增一次性 token 的独立窗口**

- 对话已开始时，下拉贴在**对话栏表头右侧**（由输入框推导列矩形），不再压住输入框或消息区；空对话仍放在「你想做什么?」下方。
- 下拉右侧新增 `↗`：向 Host 申请一次性票据（60 秒、单次使用），在新标签页打开官方 Studio 本体，供没有 DSH cookie 的浏览器或外部工具指认页面。
- 代理允许票据用于顶层导航（`sec-fetch-dest: document`），票据仍只由 Host 签发、只接受回环地址、兑换即作废。
- `editor:link` 走固定 `official-rpc` 通道；页面拿不到 Studio key，也拿不到任意 URL 的跳转能力。

**测试**：119 项 / 118 通过 / 1 跳过。

## 0.4.5

**模板下拉的位置改成按官方界面锚点计算**

- 旧实现把下拉放在 composer 矩形上减 42px，正好压住输入框占位文字——位置是错的。
- 新锚点优先级：空对话时放在「你想做什么?」标题下方（原来「视频复刻」卡片的位置）→ 有对话时放在「新对话」右侧 → 都找不到才停靠右上角。
- 支持现场切换，不需要改代码：`localStorage['no996.picker.anchor'] = 'heading' | 'header' | 'topright'`，刷新后生效。
- 新增控制台探针 `__no996Probe()`：返回标题/表头/输入框/列/下拉的真实矩形，用于指认位置。

**测试**：119 项 / 118 通过 / 1 跳过。

## 0.4.4

**工作台停了不再是一片死页面**

- 面板每 10 秒查一次 Host 的 Studio 状态（`POST /api/no996-openfilm/diagnose` 的 `studio.running`）。
- 连续两次「未运行」→ **自动重新 bootstrap 一次**（重建代理与 Studio，iframe 换新地址），通常用户看不到异常。
- 自动重连失败时，面板中间盖一张卡片：「工作台已停止运行 / 重新启动工作台」按钮——不再让人对着官方壳那句“退出并重新打开 OpenFilm 应用”发懵（那是桌面应用的说法，这里并不适用）。
- 关掉「视频创作」再打开、或浏览器刷新，同样会触发 bootstrap；三种路径都能恢复。

**测试**：119 项 / 118 通过 / 1 跳过。

## 0.4.3

**重载方式更正：插件可以热插拔，不必退出 DSH**

- 实测：`plugin_manager set_plugin enabled=false` → `enabled=true`（target `include:dsh-openfilm`）会让加载器重新求值 Host 模块，新代码立即生效（进程 PID 不变）。此前文档里“必须重启 Host”的说法是错的。
- 新增 `%TEMP%\dsh-openfilm-host.json`：每次插件装配写 `{version,pid,startedAt}`。重载后 `startedAt` 不是新时间，就说明看到的还是旧代码。
- 页面仍需 `Ctrl+Shift+R` 刷新：注入到官方页面的 UI 属于服务端返回的 HTML。

## 0.4.2

**界面：删掉模板首页，模板进官方界面**

- 删除面板的「开始视频创作」首页（模板网格 / 打开已有项目）：打开「视频创作」直接进官方 Studio，少一层跳转。
- 官方 Studio 页面右上（对话输入框上方）注入一个**模板下拉**：三个模板 + 「新建项目」；创建后直接跳到 `/projects/<id>`。注入代码在 `src/shell-extras.mjs`，只叠加 DOM 覆盖层，**不改上游构建产物**。
- 隐藏官方建议区里的「视频复刻」卡片（CSS/JS 隐藏，不删上游文件；找不到就什么都不做）。
- 归档轮询 5s → 15s，隐藏标签页时暂停。

**修「突然中断」的根因：把背压当断线**

- `official-event-stream` 不再因为 `response.write()` 返回 `false` 就关闭连接——那是 Node 的流控信号（数据仍在缓冲），只有在客户端真的断开或积压超过 4096 帧 / 8 MiB 时才关闭。
- 加 `retry: 3000` 让浏览器的 EventSource 按 3 秒重连；已有 25 秒 keep-alive。
- 单测覆盖：假流控推 100+ 帧不关闭、排空后按序到达；积压超上限才关闭。

**测试**：116 项 / 115 通过 / 1 跳过。

## 0.4.1

**修 503：注入的工作区指令不算并发输入**

- 真实帧显示：每轮 `turn/start` 之后，DSH 会把 prompt 组装产生的 `user/message` 也记进会话（`source.kind: "agent-instructions"`，即 AGENTS.md 块）。0.4.0 把任何非 `runtime-context` 的 `user/message` 都当并发输入 → 抛 CONFLICT → `OFFICIAL_AGENT_OUTCOME_UNKNOWN`。
- 现在只有 `source.kind === "user"` 且 `rpcId` 不匹配才算冲突；`agent-instructions` / `runtime-context` 等注入消息一律忽略，不影响归因。
- 诊断帧改成合法 JSON（字符串截断到 200 字并加省略号，不再从中间切断），且失败时追加 `{"bridgeError":{"code","message"}}` 一行，下次不必再猜。

**同版本附带**：预设自报在真机确认生效（`registered:true, ok:true`，`openfilm-video-editing` 已出现在预设清单里）。

`node --test tests/*.test.mjs` → 115 通过 / 1 跳过。

## 0.4.0

**修 503：归档会话不再以 `blocked` 伪造成协议冲突**

- 发送前读 DSH 自己的归档集合（`workspaceController.follow` / `archiveSession`），归档会话直接给出可操作提示，不再先发一轮、等 `turn/end blocked` 再把失败误报成 `OFFICIAL_AGENT_NOT_STARTED`。
- 准入归因同时接受真实事件 `agent/inbox/spliced`（`source.rpcId`）与 `user/message`；`turn/end` 的任何原因都按终态处理（`blocked` 单独分类），未归因的非 blocked 回合才判冲突。
- 归档的项目仍保留原会话绑定，不静默换绑；恢复后原样继续。

**思考与工具调用显示**

- 新增 `tool/call` → `tool_call`、`tool/result` → `tool_call_update`、`assistant/message` → 思考/正文的翻译：工具卡片（运行中 / 完成 / 失败）、参数与结果摘要、按 callId 去重、按 turn 归属（错 turn 直接丢弃）。
- 已经流式输出过的步骤不再重复输出持久化文本；单条内容截断 8 KiB、参数 4 KiB。

**归档与 DSH 侧边栏同一份真相**

- 归档即在 DSH 侧边栏归档：视频面板的对话历史隐藏、写入拒绝，恢复后历史原样返回；项目、会话、素材都不删除。
- 面板顶部出现归档横幅，提供「恢复会话」与「新建会话」（换绑新会话，旧的归档会话保留）。
- 新路由 `/api/no996-openfilm/archive`：浏览器 peer + 本机 Host/Origin + JSON + 1 KiB，只接受项目 ID，不接受 Session ID 或路径。

**预设自报**

- 启动报告改为有界重试：预设行比插件晚挂载时不再误报 "preset row not registered"；报告里带 `attempt`。

**测试**

`node --test tests/*.test.mjs` → 113 通过 / 1 跳过（新增 17 项：真实帧夹具、工具映射、归档订阅、chat RPC、迟到挂载）。

## 0.2.0

**视频剪辑模式（DSH Agent 预设）**

- 新增 `openfilm-video-editing` 预设：文件读写、搜索、终端、技能、任务与网络工具，外加一段只在该预设作用域生效的视频剪辑说明。
- 新建视频项目的会话会请求该预设；已有会话保持原样，不会被静默改写或迁移。
- 预设说明要求智能体先读 `film.html` 再改、用 `openfilm_draft` 预览移动/裁剪/分割后再保存、不动锁定轨道和原始素材、未验证不得声称已保存或已渲染。

**首页与模板**

- 视频创作面板首次打开是空白模板首页：三个模板（复刻影片 / 手绘笔记 / 纸纹讲堂），选中后在同一面板打开编辑器。
- 「打开已有项目」单独入口，不清空、不迁移已有项目。
- 模板创建失败或回执丢失时提示「项目可能已创建」，并暂停重复创建，避免建出两个项目。

**对话可靠性**

- 发送消息前等待事件流真正就绪，连接未就绪、超时或中断都会明确报错，而不是静默丢首段回复。
- 回复增量与结束事件走同一条有序通道；页面不再根据请求返回提前伪造「已完成」。
- 结束原因按 DSH 真实契约区分：完成、用户取消、模型失败、上下文阻塞、超限、中断。
- 模型失败只显示安全分类（认证失败 / 权限拒绝 / 限流 / 服务不可用 / 请求被拒），不把原始错误、凭据或私有路径带到页面。
- 请求可能已被受理但回执丢失时，项目被锁定并要求人工确认，不会自动重发造成重复执行。
- 「已明确结束」的失败不再永久锁死项目。
- 发送消息不再覆盖用户选定的模型。

**模板包**

- `paper-texture` 的两个静态页面补上 OpenFilm `window.film` 帧接口，三个模板均通过官方解析器校验。
- 模板复制改为独占创建、拒绝符号链接与超限内容、真实统计文件与体积；注册失败保留目录并报告不确定结果，不擅自删除可能已注册的项目。

**安全**

- 回环端口上的调试页不再提供匿名「创建项目」入口，只展示模板；创建一律走 DSH 已鉴权的面板通道。
- 新增接口要求 DSH 浏览器会话、固定本机 Host/Origin、JSON 与 1 KiB 请求体上限、模板白名单，且只返回项目 ID。

**测试**

`node --test tests/*.test.mjs` → 86 通过、1 跳过（跳过项需 `DSH_PINNED_SOURCE` 指向只读的 DSH 源码）。其中包含使用官方 `openfilm` 0.3.1 服务端 `openProject` 的真实项目注册验证（临时 `OPENFILM_HOME`，不触碰用户库）。

## 0.1.16 及更早

OpenFilm 官方 Studio + 官方对话列的接入、DSH 会话桥接、固定端口调试页、模板打包与基础安装流程。

