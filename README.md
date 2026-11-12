# dsh-openfilm

OpenFilm 视频创作作为 DSH 插件：整页官方 Studio 0.3.2 + 官方对话列，对话经 Host 桥到 DSH 会话。0.7.0 起，右侧对话能看真画面、能落盘改时间轴、能导出，审批与打断在页面这一侧可见可答。

## 文档

接手开发只看这五份，其余都是历史：

| 文档 | 给谁 | 内容 |
|---|---|---|
| **[docs/HANDOVER.md](docs/HANDOVER.md)** | **接手的智能体** | **五分钟上手、五条红线、当前状态、三类故障先查哪里** |
| [AGENTS.md](AGENTS.md) | 智能体 | 红线、仓库地图、重载矩阵、诊断入口 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发者 | 架构、启动时序、请求路径、模块职责、安全模型、构建/生效/发版 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 开发者 | **接下来做什么**：0.9.1 账号与登录，之后的批次，已知边界 |
| [docs/NOTES.md](docs/NOTES.md) | 考古 | 决策纪要与踩坑记录（历史，不必先读） |
| [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md) | 验收者 | 真机验收清单 |

细节手册：[docs/TEMPLATES.md](docs/TEMPLATES.md)（模板）、[docs/HOT-RELOAD.md](docs/HOT-RELOAD.md)（三档热更新）。

> **不是热加载**：改客户端源码要 `npm run build` + 刷新页面；改 Host 源码要重启 DSH；改 `vendor/templates` 下一次请求即生效。详见 `AGENTS.md` §4。

## 下载与更新（0.9.0）

从 [GitHub Releases](https://github.com/NewbieCheng/dsh-openfilm/releases) 下载 `dsh-openfilm-0.9.0.tgz`，在 DSH 插件管理器中安装该包，或通过管理器的 `install_bundle` 指定本地包路径。更新前请保存尚未保存的编辑，完成后按管理器提示重启 DSH 或刷新页面。

发布包包含 OpenFilm 0.3.2（内核与界面快照同版本；界面快照带可查的本地改动（权限菜单行、模型菜单分组与搜索、会话删除、思考可见且空块不画、模型名只显示模型、工具行显示真名、对话内联图片、底部只显示「模型 · 思考强度」），共 17 个文件，见 `vendor/official-shell/patch.diff`）、运行依赖、官方界面和模板，无需另外手动安装 OpenFilm；下载发布包本身仍需联网。宿主需提供兼容的 DSH 和 Node.js 22.2 或更高版本。自动化测试 349 项（348 通过、1 跳过），在 Windows 本机运行；macOS/Linux 尚未完成实机 GUI 验证。真机验收（右侧对话观感、审批卡、导出文件可播）按 `docs/TEST-CHECKLIST.md` 逐项执行，尚未由作者完整跑完，因此发布包里的这条链路仍属"待验收"。

**关于自动检查更新**：DSH 插件管理器的版本检查目前只支持从 npm 仓库安装的插件；GitHub 安装包和本地链接不会自动按 GitHub Releases 检查新版本。本项目目前尚未发布到 npm，需手动从 Releases 获取新包更新。

开发者也可以克隆源码并安装依赖，然后由插件管理器安装工作区目录；源码安装会通过包管理器获取依赖，与预先打包的离线安装包不同。

## 需要什么

- DSH 内核（含 `session-controller`、`storageDomain`、`webServer`）
- Node.js 22.2+（与 OpenFilm 0.3.1 的运行时要求一致）
- 首次打开会启动官方 Studio（随包内置构建产物，端口固定 47822/47821）
- 视频信息读取和部分视频处理需要系统可执行的 `ffprobe` 和 `ffmpeg`（通常随 FFmpeg 一起安装）。

### 视频组件检查与安装

打开官方 OpenFilm 界面时，插件会在运行 Studio 的 Host 进程中检查 `ffmpeg` 和 `ffprobe`，显示检查状态；有异常时区分工具未找到、无法运行、超时和检查服务失败。用户可以查看安装方法、复制求助内容给 DSH 主对话、重新检查或暂时跳过。插件不会自动下载安装，也不会代替 DSH 审批；跳过后依赖组件的功能可能不可用。

已安装但未找到时，可以在提示中填写包含两个工具的目录，复制配置求助内容到 DSH 主对话；**填写目录本身不会保存配置、执行该目录中的程序或改变 PATH**。配置前须确认目录可信、明确授权，并注意调整 PATH 可能影响 DSH 的其他程序。由于 OpenFilm 与 DSH Host 同进程运行，不能安全地在网页中热切换全局 PATH。macOS 从 Finder 打开的应用不一定继承终端 shell 的 PATH，仅修改 shell 配置不一定生效；应检查 DSH 实际启动环境。

- Windows：可使用 Windows 包管理器搜索并安装可信的 FFmpeg 软件包，例如 `winget search ffmpeg`，确认软件包来源后使用其准确 ID 安装。
- macOS：已安装 Homebrew 时运行 `brew install ffmpeg`。
- Debian / Ubuntu：运行 `sudo apt install ffmpeg`；其他 Linux 发行版请使用相应的软件包管理器。

安装后点“重新检查”；如果刚修改系统 PATH，正在运行的 DSH 可能仍使用旧环境。请先保存未保存的编辑，再完整重启 DSH 并重新检查。检查通过后重新尝试原操作；检查通过本身不保证所有视频功能正常。

对话附件目前单个文件上限为 256 MiB；较大的视频不能作为附件上传。官方输入框会先在浏览器中读取整个文件，再进入插件的大小检查，因此大文件可能在显示超限提示前就因读取或内存问题失败。附件读取或上传也可能因其他原因失败，请按界面提示处理，不要把所有附件错误都归因于缺少 FFmpeg。

## 能力与边界

- 官方对话与 DSH 会话绑定：发消息、流式回复、模型选择、取消、参考图
- 思考与工具调用在对话里显示：思考块、工具卡片（名称 / 参数摘要 / 运行中→完成或失败 / 结果摘要）
- 归档与 DSH 侧边栏是同一份集合：DSH 归档 → 面板隐藏并可恢复；面板归档 → DSH 侧边栏也消失；归档不删除、不换绑
- 审批不经过本插件（走 DSH 自身界面），不会被静默放行
- skills / 截图 / 撤销仍未接通（fail closed）

## 许可

本仓库为接入代码（MIT）。官方 OpenFilm 的构建产物与许可证见 `vendor/official-shell/`。
---

# DSH video studio (in development)

This package is an early DSH-native plugin. A local Host-side bridge displays the original OpenFilm Studio beside an embedded DSH conversation. The earlier global-conversation UI was confirmed visible; the per-project conversation, route bridge, contextual manual and resizable panel are implemented in source but have not yet been exercised in the live UI. The pre-existing global video conversation is not deleted or automatically assigned to a project.

A project's conversation is resolved by `project-conversation.mjs`: the Host asks Studio for the canonical project directory, reuses the previously mapped DSH Session when that Session still exists with the same cwd, and otherwise creates a new empty Session. The mapping is only a hint: a failed hint write is not an error and a lost hint opens a new conversation, so there is no pending state and no unrecoverable project error. Nothing is deleted or reassigned. `project-sessions.mjs` (the former two-phase registry) is retained but no longer used; its old records are left untouched. `openfilm_guide` reads the pinned upstream package's manuals for project Sessions; the existing `openfilm_draft` Agent tool remains a pure, in-memory operation. Sending messages, project-aware edits, preview, and export have not yet been verified. The upstream Studio runtime uses its own file and process permissions; DSH workspace tool sandbox policies do not constrain it. OpenFilm's text-only `askAgent` integration is wired to the DSH default model in source; image, video and audio generation are not bridged to DSH. Some Studio routes and representations are restricted by the bridge; full feature compatibility, preview and export remain unverified.

## Official desktop Chat integration (stage 1: shell served, Agent not yet bridged)

The pinned OpenFilm 0.3.1 desktop shell is built separately from its matching official source and packaged into `vendor/official-shell/ui`. `scripts/build-official-shell.mjs` checks the source checkout's exact commit and records asset hashes; it packages a previously built shell and does **not** establish build provenance or download dependencies. The generated manifest includes OpenFilm's license and upstream notices. Review the bundled third-party licenses before distribution: the upstream notice is short and does not carry the full React / Inter / Lexical texts.

By default the video panel now serves that official shell, whose own chat column replaces the DSH conversation beside Studio. Set `NO996_OPENFILM_DSH_CHAT=1` before the Host starts to fall back to the embedded DSH conversation. Stage 1 status:

- The shell's preload facade (`src/official-facade.mjs`) supplies layout, theme, preferences and project-scoped chat persistence; the project chat store (`src/official-chat-store.mjs`) lives in its own DSH storage domain with a revision guard, and never reads or deletes upstream `.film/chat` history.
- User-picked files upload through Studio's own import endpoint (`assets/upload/…`); nothing writes project files through Node directly.
- The official chat sends through the Host: `localAgents.start/prompt/cancel/setOption` map to a project's DSH Session via `/__dsh/official-rpc`, and assistant deltas stream back over `/__dsh/official-events` (SSE). Model choices come from the Host catalog; reference images are forwarded as typed image parts and re-validated by the Host. Approvals stay with DSH's own UI: this plugin has no pending-interaction subscription, so a tool that needs approval is answered there and never auto-allowed. Skills, screenshots and undo still fail closed.
- Trust model: the editor origin is treated as the official OpenFilm window for this local user, matching upstream's own desktop trust model. Project IDs are still validated against Studio's live project list. A signed per-frame scope (`official-project-scope.mjs`) can tighten this later.

## Upstream updates

The production Studio runtime is the official OpenFilm npm release declared by the exact tarball URL in `package.json`; `studio-runtime.mjs` derives its expected version from that one declaration. Update that URL to a newer official release only after reviewing its release notes, `openfilm/studio` export and `startStudio` contract, authentication/origin behavior, Node and Chromium requirements, and third-party licenses. Rebuild and verify the integration before distribution; do not silently install `latest` at runtime. The local draft/summary implementation and vendored `film-doc.mjs` are temporary compatibility code and do not automatically update with the package; review or remove them when the original Studio takes over the UI.

## Upstream provenance

`vendor/film-doc.mjs` is an unmodified copy of `packages/openfilm/src/film-doc.mjs` from [OpenFilm](https://github.com/openfilm/openfilm), commit `a85a80a9742981f0f77f61df88a2780984f8f3fb`, package version 0.3.1. Its SHA-256 is `030a3c1a8271ca47906a12af895bbbbeeb7e3c875baa98f2c8621c1837369e4a`. Its MIT license is included as `vendor/LICENSE`. OpenFilm's trademark, other third-party components, assets and media-provider terms require separate review before distribution.

`src/project-core.mjs` is an isolated local experiment; it is **not** registered by the plugin. Its cooperative lock is not an atomic compare-and-swap against external writers, nor is its Node filesystem a substitute for DSH's sandbox. Do not connect it to the UI or tools as an authorization boundary. A DSH filesystem-backed service and a clear conflict and isolation model are needed first.

Upstream film pages may contain arbitrary executable HTML/JavaScript. Do not execute them in the DSH origin or assume the upstream local server/renderer confines network, files or projects. No render sandbox is implemented.


