# 不加班剪辑 · No996 Studio

把 **OpenFilm 0.3.2** 视频工作台做成 DSH 插件：官方 Studio 与桌面壳整页常驻在侧边栏，右侧对话由 Host 交给 `dsh --profile acp` 子进程（会话就是 DSH 会话，模型、审批、思考、续聊都是 DSH 的）。

版本以 `package.json` 与 [CHANGELOG.md](CHANGELOG.md) 为准；"现在到哪了"看 [docs/STATUS.md](docs/STATUS.md)。仓库：`NewbieCheng/dsh-openfilm`，分支 `main`。

## 安装

从 [GitHub Releases](https://github.com/NewbieCheng/dsh-openfilm/releases) 下载 `dsh-openfilm-*.tgz`，在 DSH 插件管理器里安装该包（或用 `install_bundle` 指定本地路径）。

需要：

- DSH 内核（含 `session-controller`、`storageDomain`、`webServer`）
- Node.js 22.2+
- `ffmpeg` / `ffprobe`（读视频信息、部分处理）；缺了会在界面里提示，不会自动安装

更新前先保存未保存的编辑；安装后按管理器提示重启 DSH 或刷新页面。发布包已内置 OpenFilm 运行时、官方界面与模板，不需要另外装 OpenFilm，但下载发布包需要联网。

## 用起来

- 侧边栏「视频创作」打开工作台；官方界面的对话列由 Host 通过 ACP 驱动一个 DSH 子进程，会话与侧边栏是同一份。
- 一个项目 = 一条对话（工作目录就是项目文件夹）；归档与 DSH 侧边栏是同一份集合。
- 对话里能看到思考、工具调用（真名 + 参数 + 结果摘要）、内联图片；审批走 DSH 自己的界面，不会被静默放行。
- 图片：当前模型支持看图时内联发送；不支持时落成临时文件并以绝对路径引用。上传兜底单文件上限 256 MiB；更大的视频请先剪辑或转码。
- 项目首次被面板打开时，Host 会在项目文件夹写一份 `AGENTS.md`（编辑指令，已存在则绝不覆盖）。
- 本地口播转写：`openfilm_transcribe`，视频/音频 → 带时间码文稿；首次下载 228 MB 权重。

## 文档

| 文档 | 给谁 | 内容 |
|---|---|---|
| [docs/index.md](docs/index.md) | 所有人 | 文档地图：哪篇属于规格/决策/参考/流程/进度 |
| [AGENTS.md](AGENTS.md) | 智能体 | 红线、改哪一层、生效矩阵、证据入口 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发者 | 启动时序、请求路径、模块职责、构建 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 开发者 | 进程模型与边界（不含进度） |
| [docs/STATUS.md](docs/STATUS.md) | 所有人 | 当前版本、这批做完什么、待真机验证 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 所有人 | 接下来做什么、待拍板、明确不做 |
| [docs/decisions/](docs/decisions/README.md) | 维护者 | 每条设计决定的理由与代价（ADR） |
| [docs/reference/ui-layers.md](docs/reference/ui-layers.md) | 改界面的人 | 四层界面、手段分级、DOM 锚点、模型/权限来源 |
| [docs/playbooks/ui-change.md](docs/playbooks/ui-change.md) | 改界面的人 | 决策表、标准流程、验证、反模式 |
| [docs/playbooks/release.md](docs/playbooks/release.md) | 发版的人 | 版本、打包、发布、回滚 |
| [docs/playbooks/upstream-bump.md](docs/playbooks/upstream-bump.md) | 维护者 | 三处 pin、补丁系列、升级与冲突 |
| [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md) | 验收者 | 真机验收清单 |

专题：[模板](docs/TEMPLATES.md)、[动效（含风格库与镜头卡）](docs/MOTION.md)、[口播转写](docs/TRANSCRIBE.md)、[品牌](docs/BRAND.md)、[DSH 外壳改造案例](docs/DSH-SHELL-INTEGRATION.md)。
通用 skill（独立仓库）：[dsh-harness-remix](https://github.com/NewbieCheng/dsh-harness-remix)（DSH UI 改造 + 后端衔接）。

## 能力与边界

- 已接通：项目/对话/模型/审批/取消、思考与工具行、内联图片、归档、模板安装、抽帧、时间轴落盘编辑、导出、CLI 兜底、本地转写。
- 未完成：余额展示、官方输入框在部分场景只读、默认权限不是完全访问、技能卡、预览/渲染沙箱、macOS/Linux 真机验收。
- 账号：接工作台账号（不是 OpenFilm 站点账号）；未登录由壳内登录页挡住剪辑。`NO996_OPENFILM_DEV=1` 可跳过账号门做开发。

细节和"为什么"以文档为准；`docs/ROADMAP.md` 里标了状态，不要把"待做"写成"已完成"。

## 许可

本仓库的接入代码为 MIT。官方 OpenFilm 的构建产物、许可证与商标声明见 [vendor/official-shell](vendor/official-shell) 与 `THIRD_PARTY_NOTICES.md`；产品名与标识不代表上游背书。

---

## English summary

`dsh-openfilm` packages the official OpenFilm 0.3.2 studio and desktop shell as a DSH plugin. The Host starts the official Studio on a loopback port, reverse-proxies it, and bridges the shell's chat column to a DSH session (models, approvals and cancellation stay DSH's). The official UI is vendored as a pinned build with a reviewable, replayable source patch series.

Install from GitHub Releases into DSH. Node 22.2+, DSH with `session-controller`/`storageDomain`/`webServer`, and `ffmpeg`/`ffprobe` for video metadata. Upstream is MIT; its license, notices and trademark terms are preserved under `vendor/official-shell`. Product names and marks here do not imply upstream endorsement.
