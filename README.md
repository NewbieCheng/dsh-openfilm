# 不加班剪辑 · No996 Studio

把 **OpenFilm 0.3.2** 视频工作台做成 DSH 插件：官方 Studio 与桌面壳整页常驻在侧边栏，右侧对话经 Host 桥接到 DSH 会话（模型、审批、会话都是 DSH 的）。

当前 `0.12.1`（上一个发布包是 `0.12.0`）。仓库：`NewbieCheng/dsh-openfilm`，分支 `main`。

## 安装

从 [GitHub Releases](https://github.com/NewbieCheng/dsh-openfilm/releases) 下载 `dsh-openfilm-*.tgz`，在 DSH 插件管理器里安装该包（或用 `install_bundle` 指定本地路径）。

需要：

- DSH 内核（含 `session-controller`、`storageDomain`、`webServer`）
- Node.js 22.2+
- `ffmpeg` / `ffprobe`（读视频信息、部分处理）；缺了会在界面里提示，不会自动安装

更新前先保存未保存的编辑；安装后按管理器提示重启 DSH 或刷新页面。发布包已内置 OpenFilm 运行时、官方界面与模板，不需要另外装 OpenFilm，但下载发布包需要联网。

## 用起来

- 侧边栏「视频创作」打开工作台；官方界面的对话列直接连 DSH 会话。
- 一个项目 = 一个工作区 = 一条对话；归档与 DSH 侧边栏是同一份集合。
- 对话里能看到思考、工具调用（真名 + 参数 + 结果摘要）、内联图片；审批走 DSH 自己的界面，不会被静默放行。
- 对话附件单个上限 256 MiB；更大的视频请先剪辑或转码。
- 本地口播转写：`openfilm_transcribe`，视频/音频 → 带时间码文稿；首次下载 228 MB 权重。

## 文档

| 文档 | 给谁 | 内容 |
|---|---|---|
| [AGENTS.md](AGENTS.md) | 智能体 | 红线、改哪一层、生效矩阵、证据入口 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发者 | 架构、请求路径、模块职责、安全模型、构建/发版 |
| [docs/UI-PLAYBOOK.md](docs/UI-PLAYBOOK.md) | 改界面的人 | 四层界面、两种手段、决策表、注入登记表 |
| [docs/UPSTREAM.md](docs/UPSTREAM.md) | 维护者 | 三处 pin、补丁系列、升级与冲突处理 |
| [docs/BRAND.md](docs/BRAND.md) | 产品/设计 | 品牌唯一来源、替换步骤、法务边界 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 所有人 | 接下来做什么、已知边界 |
| [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md) | 验收者 | 真机验收清单 |
| [docs/NOTES.md](docs/NOTES.md) | 考古 | 关键决策与故障档案 |

专题手册：[模板](docs/TEMPLATES.md)、[动效生产](docs/MOTION.md)、[风格库](docs/STYLES.md)、[镜头卡](docs/SHOT-CARDS.md)、[口播转写](docs/TRANSCRIBE.md)。

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
