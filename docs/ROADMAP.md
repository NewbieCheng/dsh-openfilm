<!-- doc
id: roadmap
reader: 所有人（接下来做什么）
fact-source: 上一版 ROADMAP 的剩余项、STATUS 的待验项、用户拍板记录
checked: 0.15.1
rot-if: 每个批次开始/结束、任何"待拍板"有结论
-->

# 路线图

> 只写**未来**。已完成的不在这里（看 [`../CHANGELOG.md`](../CHANGELOG.md)），当前版本与待验项看 [`STATUS.md`](STATUS.md)。
> 状态：`待做` / `进行中` / `已定但不急` / `待拍板`（需要产品决定，不要自己开工）。
> 一版做一批：攒够可验收的批次再发版号。

## 1. 下一批：注入收口（决策见 [ADR-0009](decisions/ADR-0009-ui-change-strategy.md)，人话版见 [topics/ui-plan.md](topics/ui-plan.md)）

> 目标不是"少写几行注入"，是让"上游一重渲染就消失"的 bug 绝迹。
> 一批做 2–3 条，做完一批真机验一批。

| 项 | 内容 | 状态 |
|---|---|---|
| U5 故障卡/恢复卡转源码 | `apps/desktop/shell/RecoveryGate.tsx`，注入已删 | 源码完成 / 真机待验 |
| U2 环境检查卡转源码 | `apps/desktop/shell/EnvironmentNotice.tsx`，注入已删 | 源码完成 / 真机待验 |
| U1 模板选择弹窗转源码 | `apps/desktop/chat/src/components/TemplatePicker.tsx`；旧注入先让路不删 | 源码完成 / 真机待验 |
| U4 登录首页进壳 | 构建期 `login:sync` + 壳内 import，界面实现仍是原 DOM | 已不再注入 / 真机待验 |
| U3 账号条/登录态 | 本来就在 `WorkbenchAccount.tsx`（补丁） | 无需迁移 |
| U6 主题进构建 | 发布产物由 `shell:bake` 烘进，运行时那份只是开发热更 | 无需迁移 |
| U1 旧注入删除 | 真机验收通过后删掉 `shell-ui.js` 里的弹窗与让路判断 | 待做（验收后） |
| U7 侧栏开关 | DSH 无源码，保持窄注入（ADR-0006） | 保持 |
| 全路径回归 | 登录 → 引导 → 丢素材 → 开剪 → 导出 | 待做 |
| O1 片型引导 | `OnboardingGate` + 偏好记忆已进壳 | 源码完成 / 真机待验 |
| O2 AI 剪辑员工 | 栏头、空态、拖放提示已进壳 | 源码完成 / 真机待验 |
| 素材入库确认 | 对话拖放 → AI 入库 → 对话内确认；失败可重试 | 提示已改 / 入库仍走附件 |

## 1.1 出了这个仓就不叫"一处"

- `.upstream/openfilm` 是唯一的上游工作区（1.3 GB，gitignore），不再另开 checkout；
- 改完必须 `npm run patches:check` + `npm run check`，否则下一个人拉到的是"改了但没记"的树。

## 2. 之后（一个批次一起做）

| 项 | 内容 | 状态 |
|---|---|---|
| 动效剩余风格 | 12 极光、20 像素；01 扁平 / 02 包豪斯已进 motion-styles | 待做 |
| WebGL 探针 | 10 / 22 两张卡是否值得搬 | 待拍板 |
| 24 张可执行配方 | `_kit/shots` 尚不存在 | 待做 |
| 动效 lint / 帧检 | 模板脚本确定性 lint；导出后黑场/静止帧检（`openfilm_export kind=stills` 已有） | 待做 |
| 声音层 | 节拍 / 音效 / 旁白 | 已定但不急 |
| 首启向导 L2 | 三步、只跑一次（与 O1 的归属待拍板） | 待做 |
| 组件安装器 L4 | `system/check`、`system/install`、`onboarding/complete` 路由 | 待做 |
| 面板「安装语音模型」 | 228 MB 权重的一键安装卡片（Host 路由已就绪，缺 UI） | 待做 |
| 转写 Worker 化 | 长音轨不再占 Host 事件循环 | 待做 |
| 逐字时间戳 / 说话人分离 | 逐字换 Paraformer-zh；多人要声纹 | 已定但不急 |
| 技能卡 | `skill` 调用画成独立卡片 | 待做 |
| DSH 图片块内联 | 用户直接在 DSH 对话里贴的图，面板里能看见 | 待做 |
| 「用 DSH 视图打开」 | 面板右上角入口，新窗口打开原生会话视图（对照用） | 已定但不急 |
| 注入收进上游 | 除 `openfilmNative` 外，其余逻辑搬进上游 `dsh` 分支 | 已定但不急 |
| 模板字体子集化 | `sketchnote` 内嵌字体 10.4 MB，影响首屏 | 待做 |
| 账号余额与引流卡收口 | 登录后显示积分/套餐；壳里「去登录/下载桌面端」替换或隐藏 | 待做 |

## 3. 待拍板

| 事项 | 现状 | 要决定 |
|---|---|---|
| 12/20 风格是否继续 | 两张卡成本高 | 做 / 不做 |
| WebGL 探针 | 10/22 依赖 WebGL | 是否投入 |
| `openfilm_motion` 工具 | 目前没有，动效靠模板 | 要不要加 |
| 首启向导归属 | 与 O1 片型引导职责重叠 | 谁管首次 |
| ffmpeg 是否打包 | 现在要求用户自装 | 打包 +70 MB 还是继续提示 |
| ASR 是否默认勾选 | 首次 228 MB | 默认装 / 询问 |
| 工作区标题 | 带随机后缀的项目名是否截短 | 截 / 不截 |
| 术语表/热词 | 现在靠事后纠错 | 是否前移到解码 |

## 4. 已知边界（不是 bug，别去"修"）

- DSH 的 Web GUI 不能嵌进面板：跨源、无会话深链、无 embed 参数、`app.asar` 不可改。只搬表达。
- 上游快照不是字节级一致：有改动的文件全部记录在 `patches/series.json`，打包器拒绝计划外改动。
- 底部状态条（缓存命中、步数、tokens）故意没有。
- 审批走 DSH 自己的界面，插件不会静默放行。
- 真正的"自动更新"不存在：发的是 DSH 插件，只能一条命令同步 + 冲突报告（[`playbooks/upstream-bump.md`](playbooks/upstream-bump.md)）。
- 权限是项目级预设，不是模型菜单项（见 [`reference/ui-layers.md`](reference/ui-layers.md) §5）。

## 5. 明确不做

- 不把 `openfilm_draft` 当保存/导出；它只是内存草稿。
- 不把 `project-core.mjs` 接进 UI 或工具当授权边界。
- 不在运行时安装 `openfilm@latest`。
- 不为单个按钮重做整页；不伪造未接通的预览/渲染能力。
- 不占 `sidebar.workspaces` 这类 single 槽（ADR-0006）。
