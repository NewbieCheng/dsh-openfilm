# DSH UI 改造配方

> 每个配方都是“目标 → 用哪个槽/锚点 → 代码 → 坑 → 验收”。
> 先读 `SKILL.md` 的认知模型；插槽细节见 `slots.md`，元素定位见 `element-map.md`。

---

## 配方 1：换掉侧栏品牌（图标/名字）

**目标**：把左上角 DSH 品牌换成自己的。
**槽**：`sidebar.brand.mark` / `sidebar.brand.name`（单人槽，注册即替换）。

```js
function MyMark() {
  return React.createElement('div', { style: { width: 20, height: 20, borderRadius: 6, background: 'var(--dsw-alias-brand-primary)' } });
}
ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
  name: 'sidebar.brand.mark', id: 'my-brand', order: 0,
}, MyMark));
```

**坑**：单人槽替换后原图标不渲染；尺寸按侧栏 42px 行高、收起时 36px rail 调。
**验收**：展开/收起、亮/暗主题、窄屏 rail 都不破。

---

## 配方 2：把“工作区”标题做成下拉（工作区 / 我的工作区）

**目标**：标题变可点下拉，切换官方列表 / 自己的列表；搜索/筛选/新建不动。
**锚点**：`div.sectionHeader > span.sectionLabel`（文本“工作区/会话”），见 `element-map.md` §1。

```js
const MARK = 'data-my-switch';
function install(doc, fetchItems, openItem) {
  let mounted = null, observer = null, popover = null;
  const cleanup = () => {
    for (const n of doc.querySelectorAll(`[${MARK}]`)) n.remove();
    if (mounted?.hidden) mounted.hidden.style.display = '';
    popover?.remove(); popover = null; mounted = null;
  };
  const mount = () => {
    const found = findWorkspaceHeader(doc);
    if (!found) { cleanup(); return; }
    if (mounted?.span === found.span && mounted.trigger?.isConnected) return;
    cleanup();
    const trigger = doc.createElement('button');
    trigger.setAttribute(MARK, '');
    trigger.textContent = '工作区 ▾';
    trigger.onclick = () => openMenu(trigger);
    found.span.parentElement.insertBefore(trigger, found.span);
    found.span.style.display = 'none';
    mounted = { span: found.span, header: found.header, trigger, hidden: found.span };
  };
  // …MutationObserver + requestAnimationFrame 节流，见 SKILL.md §5
  return () => { observer?.disconnect(); cleanup(); };
}
```

**坑**：
- React 重渲染会换 `span`，每轮先 `cleanup`，否则出现两个按钮；
- 标题在“工作区/会话”之间切换，两个文本都要匹配；
- 切换到自己列表时，隐藏 `header` 之后的兄弟（官方列表），而不是删；
- 点击条目后如果要打开面板，先 `localStorage` 记住项目，再触发入口点击（或走你的事件总线）。

**验收**：切换后官方列表能回来；搜索框仍能用；刷新后状态保持。

---

## 配方 3：新增一个全局面板（侧栏入口 + 主区 + 常驻 iframe）

**目标**：点侧栏入口，主区显示你的面板，切页不重载。

```js
// 左：入口（id 同时是 main 的 key）
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist', id: 'my-panel', order: 21, locale: NS,
  label: () => '我的面板',
}, MyIcon));

// 中：占位
ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main', key: 'my-panel', order: 10, locale: NS,
}, Seat));

// 常驻：shell.overlay，跟随占位矩形
ctx.slots.inject('shell.overlay', () => ctx.slots.register({
  name: 'shell.overlay', id: 'my-panel-overlay', order: 0, locale: NS,
}, KeepAlive));
```

`Seat` 记录 `getBoundingClientRect()`，`KeepAlive` 用 `position: fixed` 跟随它（本仓 `src/panel-keepalive.mjs` 是现成实现）。

**坑**：面板打开时会话被替换（`main` 单选）；给用户“返回会话”入口。
**验收**：打开/关闭、缩放、侧栏折叠、iframe 不重载。

---

## 配方 4：全屏自定义工作台（盖住 DSH）

**目标**：自己的三栏/工作台全屏覆盖。
**做法**：`sidebar.footer.action` 放入口；打开时 `createPortal` 到 `document.body`。

```js
const overlay = doc.createElement('div');
overlay.style.cssText = 'position:fixed;inset:0;z-index:1100;background:var(--dsw-alias-bg-base,#151517);display:flex;';
doc.body.append(overlay);
```

**坑**：
- `z-index` 低于 DSH 弹窗（~1200），否则设置/通知被盖；
- 全盖会盖住会话；要保留会话见配方 5；
- 必须可关闭（Esc/按钮），关闭后移除并恢复焦点。

---

## 配方 5：留洞（保留原生会话在右侧）

**目标**：左+中自定义，右侧留 520px 给原生会话。

```css
.my-cover { position: fixed; inset: 0 520px 0 0; z-index: 30; background: var(--dsw-alias-bg-base, #151517); }
.my-cover-active div.frame { grid-template-columns: 0 minmax(0,1fr) 520px !important; }
.my-cover-active div.frame > div:first-child { display: none !important; } /* 侧栏 */
/* 必要时：.centerCol { grid-column: 2 / 4 } */
```

- DSH 的 grid 是内联样式 → `!important`；
- DSH 会重写内联 grid → `MutationObserver` 监听 `div.frame` 的 style/class，重贴；
- `ResizeObserver` 跟随窗口/右栏拖宽；
- 窄屏/抽屉打开时禁用。

**验收**：会话可输入/发消息、模型菜单/思考/审批可用；缩放不错位；开关关闭完全恢复。

---

## 配方 6：把 DSH 整个嵌进你的壳（iframe / WebView）

**目标**：宿主页面/桌面壳里嵌入 DSH。

```html
<iframe src="http://127.0.0.1:47824/?token=<一次性token>"
        style="border:0;width:100%;height:100%"
        allow="clipboard-read; clipboard-write"></iframe>
```

- **认证**：token 只在 URL 里用一次，之后靠 cookie；长期带 token 会泄漏；
- **frame-ancestors**：Host 必须放行你的来源，否则白屏不报错；
- **桌面 `dsh-app://`**：相对 `/api` 会 404，需要 Host 转发/一次性 ticket；
- **同源优先**：跨源 cookie（SameSite）常被拦，反代到同 origin 最稳；
- **主题**：传 `?theme=dark` 或 postMessage；
- **双滚动条/焦点**：iframe 内独立滚动，宿主不要给 `overflow:hidden` 以外的限制。

**验收**：登录态、刷新、窗口缩放、剪贴板、键盘快捷键。

---

## 配方 7：在输入框加按钮（会话内）

```js
ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
  name: 'conversation.input.right', id: 'my-button', order: 10, locale: NS,
  inject: () => ({ /* 可用 hooks */ }),
}, MyButton));
```

**坑**：不要抢输入框的 Enter/Tab；按钮尺寸跟输入区 28–32px 行高；禁用态要可见。

---

## 配方 8：设置页加一节

```js
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section', id: 'my-settings', order: 100, locale: NS,
  label: () => '我的设置',
}, MySettings));
```

**坑**：设置是弹窗，别在 section 里再开全屏；状态要持久化（localStorage/存储域）。

---

## 配方 9：主题/配色

- 优先用变量：`--dsw-alias-bg-base`、`--dsw-alias-label-primary`、`--dsw-alias-border-l1`、`--dsw-alias-brand-primary`；
- 整套换肤走主题插件/样式文件，不要逐节点内联；
- 覆盖官方内联样式才用 `!important`，并注释原因；
- 亮/暗两套都要截图验收。

---

## 通用自检

- [ ] 注入幂等（重复挂载只有一份）；
- [ ] disposer 清理 observer/节点/事件；
- [ ] 官方功能可恢复/可触达；
- [ ] 缩放、折叠、主题、窄屏；
- [ ] 关闭开关后完全恢复；
- [ ] 记录 DSH 版本与证据。
