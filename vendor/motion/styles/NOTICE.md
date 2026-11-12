# 风格库许可与来源

- 上游：https://github.com/Vincentwei1021/mg-styles-15
- 版本：commit `49052d8`
- 许可：MIT（全文见同目录 `LICENSE`）
- 收录范围：catalog、14 份 style brief、14 份 prompt、14 支样片；未收录 04-3d-render。
- 改动：仅裁掉 04-3d-render 与仓库展示图；其余文件原样保留。

`styles/demos/*/index.html` 是上游成片的单文件源码。搬成 OpenFilm 模板时要：
1. 保留文件头署名与许可提示；
2. 包成 `window.film = { duration, width, height, ready, frame }`；
3. 资源内联或放进模板目录，禁止外链。
