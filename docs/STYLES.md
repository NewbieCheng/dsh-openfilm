# 风格库（14 种）

> 由 `scripts/build-motion-index.mjs` 从 `vendor/motion/styles/catalog.json` 生成，不要手改。
> 上游 [mg-styles-15](https://github.com/Vincentwei1021/mg-styles-15)（MIT，commit `49052d8`）。

| 风格 | 引擎 | 画幅/时长 | 节奏 | 搬样片要带的依赖 | 一句话 | 入口 |
|---|---|---|---|---|---|---|
| **01-flat-vector** 扁平矢量·一点成城 | canvas2d | 16:9 / 10s | 120 bpm · 15f 切 | 单文件 | 一点落地弹成太阳，长出一座城，再收进窗里变回一个点。 | `demos/01-flat-vector/cues.json` |
| **02-line-art** 一笔画·金线 | canvas2d | 16:9 / 10s | 72 bpm · 13f 切 | 单文件 | 一根金线从不抬笔，7.5 秒画完一座城，收成金币字标。 | `demos/02-line-art/cues.json` |
| **03-isometric** 等轴 2.5D·浮岛城市 | three | 16:9 / 10s | 120 bpm · 15f 切 | 单文件 | 12×12 瓦片波浪落下，长成一座浮岛城市，最后拉远露字。 | `demos/03-isometric/cues.json` |
| **05-cel-boil** 逐帧手绘·线条沸腾 | canvas2d | 16:9 / 10s | 120 bpm · 2f 切 | 单文件 | 一拍二的纸上手绘：每换一张画墨线重抖一次，填色故意错位 5px，唯一饱和色是番茄红。 | `demos/05-cel-boil/cues.json` |
| **06-collage** 拼贴剪贴·撕纸印刷 | canvas2d | 16:9 / 10s | 90 bpm · 3f 切 | 单文件 | 牛皮纸上的撕边剪贴与半调印刷，所有动作量化到 12fps，每个元素自己会抖。 | `demos/06-collage/assets/gen/layout.json` |
| **07-liquid** 液态流动·棚拍稠液 | webgl2 | 16:9 / 10s | 150 bpm · 2f 切 | 单文件 | 暗紫棚里的稠液体：橙粉紫按厚度混色，落地压扁回弹，最后把液滴拉成字形。 | `demos/07-liquid/cues.json` |
| **08-morph** 一形万象·形变 | canvas2d | 16:9 / 10s | 150 bpm · 25f 切 | 单文件 | 始终只有一个实心剪影：轮廓等点数重采样后逐点插值，必经圆形中介变出八个图标。 | `demos/08-morph/cues.json` |
| **09-bauhaus** 几何构成·包豪斯 | webgl2 | 16:9 / 10s | 120 bpm · 15f 切 | 单文件 | 红黄蓝三原色 + 基础几何 + 严格 120px 网格，按拍切换的构成主义排版。 | `demos/09-bauhaus/cues.json` |
| **10-synthwave** 复古霓虹·合成器浪潮 | three | 16:9 / 10s | 100 bpm · 18f 切 | 单文件 | 深紫夜空下的透视霓虹网格与分层日落，镀铬标题砸入、手写霓虹点亮、全程 VHS 做旧。 | `demos/10-synthwave/cues.json` |
| **12-aurora-glass** 弥散渐变·玻璃拟态 | webgl2 | 16:9 / 10s | 80 bpm · 22f 切 | 单文件 | 近黑底上 7 块色斑缓慢漂移，玻璃卡带 1px 内描边与近边折射，一切都慢。 | `demos/12-aurora-glass/cues.json` |
| **18-hanazi** 综艺花字 | canvas2d | 16:9 / 10s | 120 bpm · 15f 切 | 单文件 | 竖屏三层描边花字：白边 + 彩边 + 硬挤出，弹簧入场，字字都歪。 | `demos/18-hanazi/cues.json` |
| **19-paperclip** 粗描边贴纸科普 | canvas2d | 16:9 / 10s | 120 bpm · 15f 切 | 单文件 | 一块 2400×5900 的手机屏世界，镜头一路下飞，白描边贴纸配精确图表。 | `demos/19-paperclip/assets/countries-110m.json` |
| **20-pixel** 像素 8-bit·横版卷轴 | webgl2 | 16:9 / 10s | 150 bpm · 3f 切 | 单文件 | 每个像素是 6×6 输出方块，QUEST-32 色板配 4×4 Bayer 抖动的横版卷轴… | `demos/20-pixel/cues.json` |
| **22-hud** 赛博 HUD·FUI | three | 16:9 / 10s | 120 bpm · 5f 切 | 单文件 | 96% 的黑底上一束青，401px 扫描环配乱码定值的等宽数字，全程轻微 glitch。 | `demos/22-hud/cues.json` |

## 怎么用

1. 先看样片（`vendor/motion/styles/demos/<slug>/index.html`）——多数是"给定 t 画一帧"的页面，但**不是**拿来就能跑：上表倒数第二列写明要带哪些依赖；
2. 读同 slug 的 `briefs/<slug>.md`：signature（签名动作）、色板、字体、节奏；
3. 按 `docs/MOTION.md` 的 G2 先做一镜定调帧，风格对了再铺开；
4. 引擎是 `three` 的两支（10/22）先确认 Studio 渲染路径支持 WebGL，再决定要不要搬。
