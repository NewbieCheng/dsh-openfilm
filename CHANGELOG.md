# 更新记录

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
