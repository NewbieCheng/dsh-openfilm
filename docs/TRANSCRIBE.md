<!-- doc
id: transcribe
reader: 用转写的人、维护者
fact-source: src/transcribe-service.mjs、scripts/asr-*.mjs
checked: 0.15.3
rot-if: 模型、路由或权重来源变化
-->

# 本地口播转写（openfilm_transcribe）

> 用户丢一个口播视频过来，先出带时间码的文稿，再按文稿剪。**全部在本机 CPU 上跑**，音频不出这台电脑。

## 为什么是这个形状

| 决定 | 原因 |
|---|---|
| SenseVoice-small **int8** | 中文口播准确率高、非自回归、CPU 上快；自带 ITN 头，中文标点直接出来，不用再挂标点模型 |
| sherpa-onnx 的 Node 绑定 | 官方预编译包覆盖 win-x64 / win-arm64 / darwin-arm64 / darwin-x64，免 Python、免编译；模型只加载一次 |
| ffmpeg 抽 16 kHz 单声道 PCM | 500 MB 视频 → 10 分钟音轨约 19 MB（约 1/20），且**视频不进 Node 堆** |
| 能量（RMS）切段，不再上一个 VAD 模型 | 口播是单人声 + 真停顿，RMS 包络够用；少一个运行时、少 2 MB 权重、少一类失败 |
| 逐段解码，段间让出事件循环 | 单段 ≤ 15 秒，Host 不会被长时间占住 |
| 缓存键是**文件内容**指纹（大小 + mtime + 头尾各 256 KB） | 复制/改名命中缓存；改过的文件必然重转 |

## 流水线

    视频/音频（ffmpeg 能解的任意格式）
      → ffmpeg -vn -ac 1 -ar 16000 -c:a pcm_s16le → 临时 wav
      → 20 ms 帧 RMS → 自适应阈值 → 语音段（合短停顿、拆超长段）
      → 每段 Float32 送 SenseVoice（decodeAsync）→ 文本
      → 按句号/问号切句，句时间在段内按字重插值
      → .openfilm/transcripts/<key>.json + 返回段表
      → （默认）DSH 会话模型校对同音字与专名：只有文本变，时间码不变

## 用法（对模型）

    // 1) 看是否已就绪 / 下载进度
    openfilm_transcribe({ status: true })

    // 2) 显式开始下载（from: 首次调用也会自动触发）
    openfilm_transcribe({ setup: true })

    // 3) 转写：本机绝对路径，视频或音频都行
    openfilm_transcribe({ from: "C:\\clips\\talk.mp4", lang: "zh", maxChars: 6000 })

返回文本包含：时长、段数/句数、RTF、模型名、是否命中缓存、完整 JSON 路径、逐段 `[mm:ss.d–mm:ss.d] 文本`、以及截断的全文。

`refine: false` 可跳过模型校对；校对失败的原因（段太多 / 格式不对 / 请求失败）会写在「校对：」一行，且**绝不改动时间码**。

## 安装（首次 228 MB）

模型不随 npm 包发布，首次使用时下载到：

    $DSH_HOME/no996-openfilm/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/
      model.int8.onnx   239 233 841 B   sha256 c71f0ce0…
      tokens.txt            315 894 B

三条入口都能启动，且**单飞**（同一时刻只有一个下载）：

| 入口 | 说明 |
|---|---|
| 对话 | `openfilm_transcribe({from})` 首次调用 → 回「已自动开始下载」，`status` 看进度 |
| 面板/控制台 | `POST /api/no996-openfilm/asr` body `{"action":"install"}` → `{ready,bytesOnDisk,progress,installing}` |
| 命令行 | `node scripts/asr-models.mjs fetch` |

下载写 `.part` 再改名，校验大小与 sha256；断网或中断不会留下「看起来能用」的半份模型。

## 上限与失败码

| 条件 | 行为 |
|---|---|
| 无音轨 | 拒绝，`NO_AUDIO`（在抽 PCM 之前就拒） |
| 音轨 > 3 小时 | 拒绝，`TOO_LONG`，消息里给分钟数并建议切段 |
| 全段静音 | `NO_SPEECH` |
| 识别结果为空 | `EMPTY_TRANSCRIPT`（纯音乐 / 强噪 / 非支持语言） |
| 模型未就绪 | `MODEL_NOT_READY`，并自动开始下载 |
| 引擎没装 | `ENGINE_MISSING`（`npm install` 后可用） |
| 文件不存在 / 读不了 | `NOT_FOUND` / `UNREADABLE_MEDIA` |

## 实测（2026-11-12，Windows 11 / Node 24.20 / 纯 CPU，无 GPU）

| 样本 | 音轨 | 段数 | 墙钟 | RTF | 备注 |
|---|---|---|---|---|---|
| zh.mp4（HF 官方中文测试音频，包进 mp4） | 5.632 s | 1 | 2.04 s | **0.085** | 含 1.55 s 一次性模型加载 |
| three.wav（同一句 ×3，中间 1.2 s 静音） | 19.176 s | 3 | 2.25 s | **0.039** | 段首尾 0.76–5.08 / 7.56–11.88 / 14.34–18.66，与静音边界吻合 |

两份样本识别一致：`派饭时间早上9点至下午5点。` —— 原话应为「营业时间」，这类同音错正是 `refine` 存在的理由。

## 已知边界（别当成已完成）

- **macOS 未在本机实测**：只靠官方预编译包的存在性；首台 Mac 要按 `playbooks/manual-acceptance.md` 走一遍。
- **长任务在会话里同步跑**：3 小时音轨约 5–8 分钟，若上层有工具超时会先断。后续可挂 Worker。
- **没有说话人分离**：多人时是一整段文本。
- **没有逐字时间戳**：句级时间按段内字重插值，够字幕，不够卡拉 OK 高亮。要逐字就换 Paraformer-zh（同一套 sherpa 接口）。
- **热词/术语表未做**：目前靠 `refine` 事后纠错。
- **面板 UI 没有安装按钮**：Host 路由已就绪（`/api/no996-openfilm/asr`），按钮本身待做。
- **首次 228 MB 下载**：内网/离线机器需要预置到上面的目录。

## 文件

| 文件 | 职责 |
|---|---|
| `src/transcribe-tool.mjs` | 工具面：权限、参数、状态/安装/转写、输出排版 |
| `src/transcribe-service.mjs` | 单队列、单飞安装、缓存、临时目录 |
| `src/asr-audio.mjs` | ffmpeg 探测/抽轨（stderr 走文件描述符，过沙箱限制） |
| `src/asr-wav.mjs` | WAV 头解析 + 窗口读（从不整文件入堆） |
| `src/asr-silence.mjs` | RMS 语音段 |
| `src/asr-pipeline.mjs` | 编排：闸门 → 切段 → 逐段识别 → 段/句输出 |
| `src/asr-sensevoice.mjs` | sherpa-onnx 适配（懒加载、异步解码） |
| `src/asr-refine.mjs` | 会话模型校对（严格同长数组，否则丢弃） |
| `src/asr-models.mjs` | 权重清单、目录、下载与校验 |
| `scripts/asr-models.mjs` | `status` / `fetch` |
| `scripts/asr-smoke.mjs` | 真机冒烟：一个文件进，RTF 与文本出 |
