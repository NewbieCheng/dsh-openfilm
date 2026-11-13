# DSH 插槽全表（77 个）

> 提取自 DSH Web 客户端 source map（2026-11，桌面版）。`占用`列是**实际使用建议**，不是框架强制：
> `单` = 整块会被占用者替换，注册前想清楚；`多` = 追加式，可并列。
> 稳定性：★ 官方公开 ｜ ○ 插件内部但常见 ｜ △ 框架内部，勿依赖。

## 框架 / 布局

| 槽 | 用途 | 占用 | 稳定 |
|---|---|---|---|
| `root` | Web 壳唯一根槽，layout 在此注册三栏框架 | 单 | ★ |
| `main` | 主区；entry 带 `key`，同一时刻只显示一个 | 单 | ★ |
| `main.conversation` | “会话” entry 的挂点/别名 | 单 | ○ |
| `sidebar` | 左栏整体（注入 `{collapsed,width,drawer}`） | 单 | ★ |
| `rightbar` | 右栏整体（注入 `{width,viewportWidth,canShow}`） | 单 | ★ |
| `shell.leading` | 桌面标题栏左侧（红绿灯旁） | 单 | ○ |
| `shell.bottom` | 底部横条 | 多 | ★ |
| `shell.overlay` | 外壳之上的覆盖层（常驻面板） | 多 | ★ |

## 侧栏

| 槽 | 用途 | 占用 | 稳定 |
|---|---|---|---|
| `sidebar.panellist` | 侧栏“面板”入口列表（插件导航首选） | 多 | ★ |
| `sidebar.panellist.actions` | 入口右侧动作 | 多 | ○ |
| `sidebar.footer.action` | 侧栏底部动作 | 多 | ★ |
| `sidebar.workspaces` | 整块工作区（标题+搜索+筛选+新建+列表） | **单** | ★ |
| `sidebar.workspaces.directoryFlow` | 工作区选择流程 | 多 | ○ |
| `sidebar.workspaces.session.row.action` | 工作区会话行悬停动作 | 多 | ○ |
| `sidebar.workspaces.session.menu.item` | 工作区会话行右键菜单项 | 多 | ○ |
| `sidebar.session.row.leading` | 会话行首 | 多 | ★ |
| `sidebar.session.row.trailing` | 会话行尾 | 多 | ★ |
| `sidebar.session.row.hover` | 会话行悬停 | 多 | ○ |
| `sidebar.settings` | 设置入口 | 单 | ★ |
| `sidebar.brand.mark` | 品牌图标 | 单 | ★ |
| `sidebar.brand.name` | 品牌名字 | 单 | ★ |
| `sidebar.toggle.badge` | 折叠按钮角标 | 多 | ○ |

## 会话（conversation）——往“里面”插

| 槽 | 用途 | 占用 |
|---|---|---|
| `conversation.view` | 会话视图 | 单 |
| `conversation.content` | 会话内容区 | 单 |
| `conversation.header` | 会话头 | 多 |
| `conversation.header.leading` | 头部左侧 | 多 |
| `conversation.session` | 会话条 | 多 |
| `conversation.session.header` | 会话条头 | 多 |
| `conversation.session.header.actions` | 头部动作 | 多 |
| `conversation.session.header.corner` | 头部角落 | 多 |
| `conversation.session.header.utilities` | 头部工具 | 多 |
| `conversation.session.header.lineage` | 谱系 | 多 |
| `conversation.session.header.views.actions` | 视图动作 | 多 |
| `conversation.composer` | 输入区整体 | 单 |
| `conversation.composer.bar` | 输入条 | 多 |
| `conversation.composer.dock` | 输入停靠 | 多 |
| `conversation.input.left` | 输入区左侧 | 多 |
| `conversation.input.right` | 输入区右侧 | 多 |
| `conversation.input.dock` | 输入区停靠 | 多 |
| `conversation.input.model` | 模型选择位 | 多 |
| `conversation.input.model.label` | 模型名标签 | 多 |
| `conversation.input.permission` | 权限位 | 多 |
| `conversation.input.plan` | 计划位 | 多 |
| `conversation.input.attachments` | 附件位 | 多 |
| `conversation.input.activity` | 活动位 | 多 |
| `conversation.input.overlay` | 输入区浮层 | 多 |
| `conversation.hero.agentPreset` | 首屏预设 | 多 |
| `conversation.hero.brand.mark` | 首屏品牌图标 | 多 |
| `conversation.hero.options` | 首屏选项 | 多 |
| `conversation.hero.workspace` | 首屏工作区 | 多 |
| `conversation.hero.workspace.directoryFlow` | 首屏工作区选择流程 | 多 |
| `conversation.user.text` | 用户消息 | 多 |
| `conversation.user.text.node` | 用户消息节点 | 多 |
| `conversation.user.images` | 用户图片 | 多 |
| `conversation.chat.node` | 消息节点 | 多 |
| `conversation.chat.flow` | 消息流 | 多 |
| `conversation.chat.commandview` | 命令视图 | 多 |
| `conversation.chat.text-interaction` | 文本交互 | 多 |
| `conversation.chat.turnTail` | 轮次尾部 | 多 |
| `conversation.chat.user.content` | 用户内容 | 多 |
| `conversation.chat.user.images` | 用户图片（聊天层） | 多 |
| `conversation.chat.message.images` | 消息图片 | 多 |
| `conversation.chat.reasoning.body` | 思考正文 | 多 |
| `conversation.chat.reasoning.content` | 思考内容 | 多 |
| `conversation.chat.assistant-actions` | 助手动作 | 多 |
| `conversation.approval.card` | 审批卡片 | 多 |
| `conversation.approval.detail` | 审批详情 | 多 |
| `conversation-queue-dock` | 队列停靠 | 多 |
| `conversation-todo-dock` | 待办停靠 | 多 |

## 其他

| 槽 | 用途 | 占用 | 稳定 |
|---|---|---|---|
| `tool.call.toolview` | 工具调用视图 | 多 | ★ |
| `tool.call.images` | 工具调用图片 | 多 | ○ |
| `workspace.toast` | 工作区提示条 | 多 | ○ |
| `contextMenu.content` | 右键菜单内容 | 多 | ○ |
| `contextMenu.icon` | 右键菜单图标 | 多 | ○ |
| `settings.section` | 设置页一节 | 多 | ★ |
| `settings.general.item` | 通用设置条目 | 多 | ★ |
| `plugins.add.actions` | 插件添加动作 | 多 | ○ |
| `${key}` | 动态根（框架内部） | — | △ |

## 不存在 / 别找

- 独立聊天组件（`<Chat/>`）：没有导出；
- `chat`、`content`、`main.right`：不存在；
- “把会话放右栏”的官方槽：不存在；
- 替换整个外壳的官方槽：没有（只能用 overlay/portal 盖）。

## 用法

```js
ctx.slots.inject('槽名', () => ctx.slots.register({
  name: '槽名',
  id: 'my-entry',
  order: 10,
  locale: NS,
  label: () => '名称',
  inject: () => ({ /* 依赖 */ }),
}, Component));
```

- `inject` 返回的依赖会作为 props 传给组件；
- `shell.overlay` / `main` 的 entry 另有 `key` 语义（`main` 用 `key` 选面板）；
- 覆盖/隐藏类改造必须返回 disposer，见 SKILL.md §5。
