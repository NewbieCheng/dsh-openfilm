<!-- doc
id: features-editing-delete
reader: 维护剪辑区的人
fact-source: src/editing-project-delete.mjs、src/project-trash.mjs、src/studio-controller.mjs
checked: 0.15.2
rot-if: 删除作用域、回收站位置或守卫条件变化
-->

# 剪辑区：删除项目

删除项目是剪辑区唯一碰磁盘的破坏性操作。这里记录删除的作用域、顺序、守卫和恢复方式；实现分别在
[`src/editing-project-delete.mjs`](../../src/editing-project-delete.mjs)、[`src/project-trash.mjs`](../../src/project-trash.mjs)，
HTTP 入口是 `POST /api/no996-openfilm/editing-delete-project`（[`src/studio-controller.mjs`](../../src/studio-controller.mjs)）。

## 两级删除

| 入口 | 删什么 | 不删什么 |
|---|---|---|
| 对话行 ⋯ → 删除对话 | 这一条 Studio 对话、聊天记录、该会话的绑定；DSH 会话归档 | 项目文件夹、film、其它对话 |
| 文件夹 ⋯ → 清空对话（保留项目） | 该项目全部对话、聊天记录、绑定 | 项目文件夹、film、素材 |
| 文件夹 ⋯ → 删除项目 | 全部对话与记录、绑定、置顶/改名、项目文件夹（film、素材、.openfilm/.film） | 其它项目、DSH 会话文件本身（只归档） |

原则：**只有删除项目会碰磁盘文件**；菜单文案和弹窗都直接写出这一点。

## 顺序（失败时不留下半删状态）

1. `verifyOfficialProject(projectId)`：向 Studio `/api/projects` 重新核对项目，取 realpath；
2. 收集要归档的 DSH 会话 id（聊天记录里的会话 + 当前绑定）；
3. 停掉该项目的 ACP 子进程（Windows 上打开的文件会把 rename 变成锁错误）；
4. **移目录**（默认进回收站）：这是不可逆的一步，失败就整体失败，后面的清理都不执行；
5. 删 Studio 聊天记录（`official-chat-store.remove`）；
6. 删 ACP 绑定、置顶/改名（`acp-sessions`、`editing-prefs.remove`）；
7. 归档 DSH 会话（不删 DSH 自己的会话文件）；
8. 返回 `{ ok, trashPath, sessions }`，客户端刷新列表并 toast 回收站路径。

## 守卫

- 路径必须是绝对路径、存在、是目录，且 realpath 后不等于家目录、根目录或顶层目录；
- 目录必须含 `.openfilm`、`.film` 或 `film.html` 之一，否则 `PROJECT_NOT_OPENFILM`；
- 已在 `.no996-trash` 里的目录一律拒绝；
- rename 的 `EACCES/EPERM/EBUSY/ENOTEMPTY` 映射为 `PROJECT_BUSY`，不重试、不降级成删一半；
- 「彻底删除」只有弹窗里显式选择才传 `permanent: true`。

## 回收站

`<项目父目录>/../.no996-trash/<项目名>-<YYYYMMDD-HHmmss>-<随机>/`

- 与项目同盘，`rename` 原子移动；
- 在 `Projects` 之外，Studio 不会把它当成项目扫出来；
- 需要找回时在资源管理器里把目录移回 `Projects` 即可；v1 不做「最近删除」界面。

## 不删

- DSH 的会话文件（`~/.dsh/sessions`）：只归档；
- 其它项目、模板、Studio 安装目录；
- 项目目录之外的任何文件。

## 前端拦截

如果 `localStorage['no996.openfilm.lastProject']` 等于要删的项目（视频创作面板里正开着），弹窗会禁用删除并提示先切到别的项目；服务端的 `PROJECT_BUSY` 是文件被占用时的兜底。
