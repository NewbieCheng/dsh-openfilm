# DSH 元素定位地图

> 用途：在 DSH 外壳里找到“官方那行/那个按钮/那块列表”，做替换、隐藏或追加。
> 原则：**文本 + 结构**锚点，不写死 CSS Module 哈希类名；类名升级即变。
> 定位失败时的正确做法：查源码（见 §6），不要靠截图猜。

## 1. 侧栏“工作区”标题行（最常改）

源码结构（`@deepseek-ai/dsh-client-ui-workspace` 的 `WorkspaceBrowser`）：

```
div.root
└─ div.sectionHeader
   ├─ span.sectionLabel          ← 文本“工作区”；groupBy==='flat' 时是“会话”
   ├─ div.searchSlot
   │   └─ div.search
   │       ├─ button.searchButton   （搜索图标）
   │       └─ input.searchInput     （搜索框）
   ├─ div.headerActions             （筛选 + 新建所在）
   │   ├─ ViewOptionsMenu → button.iconButton（sliders 图标）
   │   └─ button.iconButton         （新建工作区）
   └─ div.listArea                  ← 列表：SearchResults / FlatList / SessionTree
```

### 找法

```js
function findWorkspaceHeader(doc) {
  for (const span of doc.querySelectorAll('span')) {
    const label = span.textContent.trim();
    if (label !== '工作区' && label !== '会话') continue;
    const header = span.parentElement;
    if (!header || !header.querySelector('input')) continue;
    if (header.querySelectorAll('button').length < 2) continue;
    return { span, header };
  }
  return null;
}
```

- `sectionHeader` 的**下一个兄弟**就是列表容器（隐藏它 = 隐藏官方列表）；
- 隐藏 `span.sectionLabel`，在它前面插入自己的按钮，就得到“标题变下拉”的效果；
- 搜索/筛选/新建**不要动**，否则用户少功能。

## 2. 侧栏插件入口 / 底部入口

| 元素 | 位置 | 怎么找 |
|---|---|---|
| “视频创作”这类入口 | `sidebar.panellist` | 注册，不找 DOM |
| 底部入口（全屏工作台） | `sidebar.footer.action` | 注册 |
| 面板常驻层 | `shell.overlay` | 注册 |

## 3. 设置弹窗

- 原生设置：账号与余额 / 通用设置 / 模型 / 内置插件 / Codex 订阅 / Agent 预设；
- 可插入：`settings.section`（整节）、`settings.general.item`（通用设置条目）；
- 不要自己盖一个“假设置窗”，会和原生设置打架。

## 4. 会话/输入区

| 想加什么 | 槽 |
|---|---|
| 输入框左侧按钮 | `conversation.input.left` |
| 输入框右侧按钮 | `conversation.input.right` |
| 输入条上方/下方 | `conversation.composer.bar` / `.dock` |
| 会话头部按钮 | `conversation.session.header.actions` |
| 模型标签旁 | `conversation.input.model.label` |
| 权限位旁 | `conversation.input.permission` |
| 空会话首屏选项 | `conversation.hero.options` |

## 5. 外壳/弹窗/层级

| 元素 | 定位 |
|---|---|
| 外壳 grid | `div.frame`，内联 `style.gridTemplateColumns` |
| 侧栏列 | `div.frame > div:first-child`（`sidebarCol`） |
| 主区列 | `.centerCol`（`CenterColumn`），内含 `[data-global-panel]` 的 `mainPanel` |
| 右栏列 | `[data-rightbar-col]` |
| 覆盖层 | `[data-shell-overlay]`（`shell.overlay` 所在） |
| 底条 | `[data-shell-bottom]` |
| 桌面标题栏 | `[data-shell-leading]` |
| 状态属性 | `data-sidebar-collapsed`、`data-rightbar-collapsed`、`data-global-panel` |

**弹窗层级**：DSH 弹窗/通知一般 `z-index ≥ 1200`；覆盖层用 30（壳内）或 1100（portal），别盖过弹窗。

## 6. 定位失败的兜底：直接读源码

1. 起一个临时 Web 实例：
   ```sh
   dsh web --port 47824 --no-open   # 输出带 token 的 URL
   ```
2. 取首页 HTML（带 cookie），抓 `plugins/??<pkg>/client.js&rev=<rev>`；
3. 换成 `client.js.map&rev=...` 取 source map；
4. 解析 `sections[].map.sourcesContent` 拼源码；
5. `grep -n "section.workspaces\|searchButton\|headerActions"` 找结构。

**注意**：元素定位插件（`dsh-element-source`）在这种打包客户端里常把节点指到“客户端入口文件”（如 `src/client-entry.js`），那是**误报**，不是组件源码；以 source map 为准。

## 7. 定位后自检

- [ ] 用两个不同窗口宽度试（侧栏折叠/展开）；
- [ ] 切一次“工作区/会话”（标题文字会变）；
- [ ] 切一次暗/亮主题；
- [ ] React 重渲染后节点是否被替换（需要 MutationObserver 重贴）；
- [ ] 关闭开关后原生 UI 完整恢复。
