# 开发进度 & 关键代码清单

仓库：`F:/Dev/Desktop-Projects/dsh-openfilm` · 远程 `NewbieCheng/dsh-openfilm` · 最新 `0.3.4`
测试：`node --test tests/*.test.mjs` → 96 通过 / 1 跳过 · 构建：`npm run build`

## 一、进度

| 模块 | 状态 | 说明 |
|---|---|---|
| 独立插件骨架 | ✅ | `cordis.patch.yml` 插入插件行 + 预设行，可 install/remove |
| 官方 Studio + 官方对话 | ✅ | 同面板共存，右侧对话走 DSH |
| 面板常驻（切页不重载） | ✅ | `main` 放占位，真面板挂 `shell.overlay` |
| 三内置模板 | ✅ | 官方解析器通过；官方 `openProject` 注册；跨进程持久 |
| 模板创建桥 | ✅ | 鉴权 + 白名单 + 1KiB，只回项目 ID |
| 对话可靠性 | ✅ | 就绪等待、同通道有序终态、取消不伪造、安全错误分类、未归因可重试 |
| Agent 预设 | ⚠️ | 行已挂载，卡片仍显「加载失败」，激活未通过 |
| 思考流显示 | ⚠️ | 有「正在思考」无内容（分片类型名不对） |
| 工具调用显示 | ❌ | 未翻译 |
| 输入框可编辑 | ❌ | 表现只读 |
| 默认完全访问 | ❌ | 接口未接 |
| 模板拆素材 + 首页改造 | ❌ | 未开工（新需求） |

## 二、关键代码

**Host 侧**

| 文件 | 职责 | 关键点 |
|---|---|---|
| `index.js` | 插件入口 | `inject` + `apply` |
| `src/studio-controller.mjs` | 路由与装配 | `/api/no996-openfilm/{bootstrap,diagnose,templates,debug-url}` |
| `src/official-agent-service.mjs` | 会话编排 | follow 流、prompt/取消、终态、帧记录 |
| `src/official-agent-events.mjs` | 帧→ACP 事件 | **思考/工具 bug 在此** |
| `src/official-chat-rpc.mjs` | 官方对话 RPC | 模型列/选择 |
| `src/official-approvals.mjs` | 审批通道 | 未接完 |
| `src/template-bridge.mjs` | 模板 HTTP | 鉴权+白名单+限流 |
| `src/official-templates.mjs` | 模板复制注册 | 独占创建、拒符号链接、失败不删 |
| `src/preset-report.mjs` | 预设自报 | 写 `%TEMP%\dsh-openfilm-preset.json` |
| `src/openfilm-prompt.mjs` | 预设 prompt | scoped section |

**客户端侧**

| 文件 | 职责 |
|---|---|
| `src/studio-entry.js` | 注册 `main`(占位)/`sidebar.panellist`(图标)/`shell.overlay`(面板) |
| `src/studio-panel.mjs` | 面板 UI：模板首页、iframe、预设状态行 |
| `src/panel-keepalive.mjs` | 常驻激活状态 |
| `src/official-facade.mjs` | `localAgents.*` + SSE + chat 存取 |

**资源**

| 路径 | 内容 |
|---|---|
| `vendor/templates/paper-texture` | 纸纹讲堂（2 镜 13s, 1080×1920） |
| `vendor/templates/replica-film` | 复刻影片（19 镜 121.9s, 1080×1920） |
| `vendor/templates/sketchnote` | 手绘笔记（7 镜 19.9s, 1920×1080） |

## 三、下一步（按序）

1. 读 `%TEMP%\dsh-openfilm-frames.jsonl`（0.3.4 已埋）→ 按真实类型名重写 `official-agent-events.mjs`：思考、正文、工具
2. 输入框可编辑 + 默认完全访问
3. 查预设激活失败（看 `dsh-openfilm-preset.json` 的 `broken`）
4. 模板拆素材 + 首页直进对话 + 「内置模板」下拉

## 四、命令

```
npm run build
node --test tests/*.test.mjs
plugin_manager remove_bundle  target=dsh-openfilm
plugin_manager install_bundle target=F:/Dev/Desktop-Projects/dsh-openfilm
```

## 五、红线

不碰用户项目/会话 · 测试不调真模型 · 不推工作台仓 · 未验证不报完成
