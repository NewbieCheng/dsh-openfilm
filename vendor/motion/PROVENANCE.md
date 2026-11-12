# 动效素材库来源（vendor/motion）

这两套库不是本仓原创，是从 DrawAI 的 vendored 副本原样收进来的**参考素材**，
不参与构建、不进模板运行时。搬模板时从这里取，不要从网上重新下一份。

| 目录 | 上游 | 版本 | 许可 | 收进来的内容 | 没收的 |
|---|---|---|---|---|---|
| `styles/` | [mg-styles-15](https://github.com/Vincentwei1021/mg-styles-15) | commit `49052d8` | MIT（`styles/LICENSE`） | catalog、14 份 brief、14 份 prompt、14 支可播放样片（`demos/*/index.html` + `cues.json`）、上游 README/manifest | 04-3d-render（Blender 离线渲，没有等价实现） |
| `shotcards/` | [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) | commit `1266a3e` | Apache-2.0（`shotcards/LICENSE`） | catalog、124 份镜头 recipe、美学/评审/管线/声音等 references | `demos/`（Remotion TSX，本仓跑不了，需要时按 recipe 重写） |

## 为什么只收这些

- 样片本身就是「给一个时间 t，画一帧」的网页（`window.renderAt(t)`），和本仓
  `window.film.frame(t)` 是同一件事，所以能直接改成模板页。
- recipe 的价值在**动效核心 / 参数表 / 已知坑**，不在 TSX 源码；收文本足够让模型重写。
- TSX demo 是 2.5 MB 的 Remotion 代码，本仓没有 Remotion 运行时，收进来只会被误用。

## 再同步一次

```sh
# 这两套库是 npm 包 dsh-drawai@0.4.2 的 vendored 副本，版本变了要重新核对
node -e "fetch('https://registry.npmjs.org/dsh-drawai/0.4.2')..."
```

任何一次重收都要同步更新本文件的 commit 与许可说明；许可不一致时**先停下**，
不要带着不明来源的素材发版。
