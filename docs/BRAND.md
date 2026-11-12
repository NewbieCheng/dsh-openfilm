# 品牌层（不加班剪辑 / No996 Studio）

> 目标：换名字、换颜色、换图标时，只改一个文件，不漏掉任何一个界面；同时**不删除上游的版权与商标声明**。

---

## 1. 唯一事实来源

`brand/brand.json`：

| 字段 | 用途 |
|---|---|
| `name` / `nameEn` | 界面标题、关于页、安装说明 |
| `slug` | 内部标识（未来用于目录名、更新通道） |
| `vendor` | 版权行 |
| `tagline` | 登录页/空态文案 |
| `colors.*` | 生成 `--n996-*` CSS 变量（accent / accentDeep / paper / ink / night） |
| `links.*` | 帮助、官网、反馈入口 |
| `upstream.*` | 上游名称、版本、许可证、归属声明（**只读，不许删**） |

`src/brand.mjs` 负责校验与导出：

- 名字 1–24 字符，slug 必须是小写 kebab-case；
- 颜色必须是 `#rrggbb`，缺 `accent/paper/ink` 直接报 `BRAND_INVALID`；
- 缺 `upstream` 直接拒绝——**改名不能把归属改没**。

---

## 2. 消费方

| 界面 | 现在读什么 | 状态 |
|---|---|---|
| 主题颜色 | `brandCssVars()` → `--n996-*` | 已接（`src/theme.mjs`） |
| 页面标题（tab / 历史） | 代理把上游 `<title>` 换成 `brand.name` | 已接（`replaceTitle`） |
| 面板标题 / 侧栏名 | `locale/*.json`（当前已是品牌名） | 文案已改；尚未从 brand 生成 |
| 官方壳的标题/文案 | 上游 i18n + 源码补丁 | 待接（补丁里读 `brand.name`） |
| 登录页 | `assets/shell-login.js` 里的硬编码 | 待接 |
| 关于/版本 | 面板「关于」 | 待接（同时显示我们的版本 + 上游版本 + commit） |
| 安装包/README | `package.json`、`README.md` | 部分（包名仍是 `dsh-openfilm`，这是 npm 身份，先不动） |

**原则：** 品牌是数据，不是散落在模板字符串里的常量。新增界面时先问"这里的名字从哪来"，答不上来就不许硬编码。

---

## 3. 改品牌（五步）

1. 改 `brand/brand.json`（名字、颜色、链接）。
2. 跑 `npm run brand:check`（字段合法、主题文件在位、locale 里没有残留的上游品牌）。
3. `npm run build`（如果改了客户端源码）+ 刷新页面。
4. 看一眼：登录页、壳标题、面板标题、关于页、空态文案。
5. 更新 `README.md` 的产品名与截图说明；`CHANGELOG.md` 记一条。

图标：`icon.svg` 与 `assets/logo-symbol-*.svg` 是资源文件，替换时保持文件名不变，避免同时改构建配置。

---

## 4. brand:check 检查什么

- `brand.json` 通过 `validateBrand`；
- `assets/theme/{tokens,shell,studio}.css` 存在且使用 `--n996-*` 变量；
- `locale/*.json` 的**值**里不出现上游产品名（键名与注释不算）；
- `brand.upstream` 四项齐全（名称/版本/许可证/声明）。

它**不**检查 README/CHANGELOG 里的上游提及——那些是合法的归属说明。

---

## 5. 法务边界（别越线）

- 上游是 MIT：可以修改、可以分发、可以商用；**必须保留版权声明与许可证文本**（`vendor/official-shell/source/LICENSE`、`vendor/LICENSE`）。
- 上游的 `TRADEMARK.md` 仍然有效：不能用 OpenFilm 的名字/标识暗示官方背书，不能把他们的商标注册成我们的。
- 我们的产品名与标识是独立的；界面里可以写"基于 OpenFilm 构建"，但不能写"OpenFilm 官方"。
- 第三方依赖（React / Inter / Lexical 等）的完整许可文本发布前要补齐；现在 `THIRD_PARTY_NOTICES.md` 很短，这是已知缺口，不是"已解决"。

---

## 6. 不要做

- 不要在代码里硬编码"不加班剪辑"或 `#ff6400`；一律走 `brand` / CSS 变量。
- 不要为了"看起来像自己的产品"删掉 `upstream` 字段或许可证文件。
- 不要把 `package.json` 的 `name` 改成产品名——那是 npm 包身份，改了会破坏已安装链接与更新路径。
- 不要在登录页/引导页里写死版本号；版本从 `package.json` 与 manifest 读。
