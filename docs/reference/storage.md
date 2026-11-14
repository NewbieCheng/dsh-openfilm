<!-- doc
id: storage
reader: 维护者、要加持久化的人
fact-source: src/official-chat-store.mjs、src/acp-session-store.mjs、src/preferences.mjs、DSH 的 storageDomain
checked: 0.15.8
rot-if: 换存储介质、或 DSH 改 storageDomain 形状
-->

# 数据与存储

> 原则：**DSH 是真相，我们只存提示。** 我们的文件丢了，最多丢一次"打开方便"；DSH 的文件丢了，用户丢的是会话。

## 1. 存什么、在哪

| 东西 | 位置 | 真相还是提示 |
|---|---|---|
| 项目 ↔ Session 绑定 | DSH `storageDomain`（`no996_openfilm_project_conversations`） | **提示** |
| 官方聊天记录 | DSH `storageDomain`（`official-chat-store`） | 真相（我们不碰上游 `.film/chat`） |
| ACP 会话映射 | `$DSH_HOME/no996-openfilm/acp-sessions.json` | 提示 |
| 会话历史本体 | `$DSH_HOME/sessions/<编码 cwd>/<id>/session.v4.jsonl.zstd` | **DSH 的真相，只读** |
| 附件（抽帧图等） | `$DSH_HOME/attachments/v1/objects/<前2位>/<sha256>` | 内容寻址 |
| 片型引导偏好 | `$DSH_HOME/no996-openfilm/preferences.json` | 提示（本机安装级） |
| 账号会话 | `$DSH_HOME/no996-openfilm/workbench-auth.json` | token 只在 Host |
| 预设激活报告 | `%TEMP%\dsh-openfilm-preset.json` | 诊断 |
| 插件日志 | `%TEMP%\dsh-openfilm\plugin.log`（JSON Lines，脱敏） | 诊断 |
| 帧记录 | `%TEMP%\dsh-openfilm-frames.jsonl`（每轮覆盖） | 诊断 |
| 影片项目 | `<仓库>/films/Projects/<名>-<id>/`（`film.html` + `assets/` + `manifest.json`） | 用户数据，**不入 git、不进 npm 包** |
| 项目删除回收站 | `<仓库>/films/.no996-trash/`（同盘 `rename`，可勾选彻底删除） | 用户数据 |

## 1.1 本机影片库为什么在仓库里

`films/` 是本机的影片库（用户数据），放在仓库根只为"一个文件夹里做完所有事"：

- `.gitignore` 有 `/films/`，`package.json` 的 `files` 白名单也没有它，所以既不会被提交，也不会被打进发布包；
- `tests/repo-hygiene.test.mjs` 把这两条钉住，防止哪天被 `git add -f` 或打包配置误带；
- **真正决定影片出现在面板里的，是 `%USERPROFILE%\.openfilm\studio.json` 的 `recent` 表**（绝对路径 + 稳定的项目 id）。移库要同步改这张表，否则面板说"找不到"，但影片本身没坏：项目文件夹内部不存绝对路径。

## 2. 永不删除

- 用户 Session（只归档，不删文件）；
- 上游 `.film/`；
- 项目文件（删除项目走回收站 `rename`，并由用户确认彻底删除）。

## 3. 写文件的规矩

1. **原子**：tmp → `rename`；失败回滚（Windows 上目录被占用会 `EPERM`，要有 409 和人话错误）；
2. **有上限**：JSON 读取前先看字节数，损坏就当默认值；
3. **可重建**：提示性数据损坏时，允许"重建而不是报错"；
4. **串行**：同一个文件的读改写排队，避免并发丢更新；
5. **不猜形状**：DSH 返回的字段以真机日志为准，旧扁平/新嵌套都兼容时写测试。

## 4. 诊断要什么

- 一条命令：`POST /api/no996-openfilm/diagnose { projectId }`，面板静默 20 秒后自动贴出；
- 只读、只输出状态码与类别，不带正文与绝对路径；
- 日志里能定位：`acp-session`、`acp-prompt-failed`、`workspace-*`、`permission-hint-unavailable`。

## 5. 不要做

- 不要自己维护"会话属于哪个工作区"的完整索引（见 ADR-0005）；
- 不要解析 `session.v4.jsonl.zstd` 后写回（那是 DSH 的格式）；
- 不要把业务状态塞进 `localStorage` 当真相；
- 不要在注入层读写业务存储。
