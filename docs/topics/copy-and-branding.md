<!-- doc
id: topics-copy-and-branding
reader: 改文案、换产品名、做英文版的人
fact-source: brand/brand.json、src/brand.mjs、locale/zh.json、assets/shell-ui.js、patches/series.json
checked: 0.15.8
rot-if: 文案归属层变化、patches 系列重组、新增语言
-->

# 主题：文案与品牌落在哪一层

> 这条主题横跨四层界面（见 [`reference/ui-layers.md`](../reference/ui-layers.md)），
> 所以既不是单层规格，也不是一次决策。原则一句话：**产品名只有一个来源，其余位置都是引用。**

## 1. 字符串的五个存放点

| 位置 | 管什么 | 改它之后 |
|---|---|---|
| [`brand/brand.json`](../../brand/brand.json) | 产品名、英文名、slug、vendor、口号、配色、上游声明 | 无需构建；`src/brand.mjs` 读盘，`brand:check` 校验 |
| [`locale/zh.json`](../../locale/zh.json) | 插件市场里的标题/描述 | 无需构建；`brand:check` 会拒绝出现上游产品名的值 |
| [`assets/shell-ui.js`](../../assets/shell-ui.js) | L0/L1 注入区的按钮、提示、空态 | 无需构建；注入清单变更需重载 Host |
| [`patches/*.patch`](../../patches/) | 官方桌面壳里的文案与结构（含 `080-en-US.patch` 这类语言包） | 走补丁流程：改源 → 重切补丁 → `patches:check` |
| [`vendor/templates/*`](../../vendor/templates/) | L3 影片/模板里的片名、占位文字 | 下一次请求即生效 |

运行期还有一处：`replaceTitle(html, brand)` 在代理返回 HTML 时替换 `<title>`，所以页面标题不需要改上游。

## 2. 规则

1. **不硬编码产品名。** 需要展示名字的地方引用 `brand.json` 或 `getBrand()`；`npm run brand:check` 检查 locale 与品牌定义的自洽（上游名只允许出现在 `upstream` 声明与文档里）。
2. **换名不是全局搜索替换。** 顺序是：`brand.json` → `locale/*.json` → `shell-ui.js` 里的注入文案 → 模板里的占位 → 重跑 `npm run check`。上游补丁里的文案属于"官方壳的汉化/改写"，与品牌名无关时不要动。
3. **不要手改 `client.js`**：它是 `src/studio-entry.js` 的构建产物，改文案请改源码再 `npm run build`。
4. **不要直接改 `vendor/official-shell/ui/**`**：manifest 按文件哈希校验，手改会让 Studio 起不来（`OFFICIAL_SHELL_UNAVAILABLE`）。要改壳就改补丁源。
5. **英文版跟着补丁走**：`080-en-US.patch` 是语言包位置的事实来源；新增文案若只加中文，英文界面会出现中文。

## 3. 需要一次改动多处时

按层列清单，逐层验收：

```text
L0 我们的界面      src/studio-panel.mjs / assets/shell-ui.js
L1 官方桌面壳      patches/*.patch（源在 vendor/official-shell/source）
L2 Studio 编辑器   只有 dist：文案改不了，只能 CSS；要改文案得升上游或注入
L3 影片/模板       vendor/templates/**
```

`reference/injection-registry.md` 记录当前所有注入点；新增注入必须登记，否则下次升上游时没人知道它存在。
