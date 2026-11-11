---
name: openfilm-editing
description: How to cut an OpenFilm film well — shot grammar, pacing, subtitles, transitions, sound, and export presets. Load when the person asks for anything about how the film looks, reads or sounds, or asks for a different style; the authoritative command and file reference stays with the openfilm_guide tool.
---

# 剪辑手法（OpenFilm）

这份技能只讲「怎么剪得好」，命令与文件格式以 `openfilm_guide` 为准（它读的是内核随包手册，永远和版本一致）。

## 一条片子的骨架

1. **先看再动**：`openfilm_film`（结构）+ `openfilm_frame`（画面）→ 才知道有什么、缺什么。
2. **定节奏**：一个镜头停留多久取决于信息量。开场镜头 2.5–3.5s，动作镜头 1.2–2.0s，收尾 3–5s，让最后一句话落地。
3. **一条主线**：观众一次只跟一条线；要并列就明说（分屏、字幕提示「同时」）。
4. **每次只改一件事**：改完立刻用 `openfilm_frame` 或 `openfilm_export` 取一次样片确认，别攒十个改动再一起看。

## 镜头与转场

| 场景 | 建议 |
|---|---|
| 同场景切镜 | 硬切；不要加转场 |
| 换场景 / 换时间 | 0.3–0.5s 交叉溶解；不要用花哨特效 |
| 强调（数字、结论） | 快速推近 + 0.2s 白闪，一条片子最多一次 |
| 收尾 | 淡出到黑 0.6–1.0s，配音留 0.3s 尾巴 |

- 转场总时长不超过片长的 3%；超过就显得碎。
- 不要连续三个以上特效转场（观感像 PPT）。

## 字幕

- 每行 ≤ 18 个汉字（英文 ≤ 42 字符），一行显示完，不要折行。
- 断句按语义，不按字数；句尾对齐画面切换点前后 0.2s 内最佳。
- 关键数字/品牌名单独一行并加粗，其余保持同一样式。
- 与画面保持 ≥ 32px 安全边距（1080p 下），不要压到主体。

## 声音

- 配音优先于音乐：音乐在配音区间降到 -18 LUFS 左右（或音量包络降到 30%）。
- 音效只在动作点用，一个动作一个音效，不叠。
- 全片响度对齐到 -14 LUFS（短视频）/ -16 LUFS（长片），导出前用 `openfilm_export` 的检查看一眼。

## 导出档位

| 用途 | 设定 |
|---|---|
| 预览 / 快速迭代 | 720p，CRF 28，逐帧检查用 |
| 短视频（竖屏） | 1080×1920，H.264 CRF 20，-14 LUFS |
| 横屏成片 | 1920×1080，H.264 CRF 18，-16 LUFS |
| 需要透明度 | WebM/VP9 或 ProRes 4444（先 `openfilm_export` 查本机编码支持） |

## 风格清单（person 说「换个风格」时先问这一句）

一句话就能定风格：**给谁看、多久、什么情绪**。三样齐了再动手，否则先问。
常用风格与手段：

- **干净讲解**：无转场、字幕大而少、白底或纯色背景、语速稳。
- **快节奏口播**：1.2s 切镜、字幕跟读、音效打点、数字放大。
- **故事感**：慢推镜头、环境音铺底、字幕只在关键句出现。
- **产品演示**：分屏对比、局部放大、光标跟随标注。

## 红线

- 不改 `film.html` 的结构性内容（track 顺序、clip id）除非 person 明确要求。
- 不加未在素材库出现的素材；缺素材时说清楚，用 `openfilm_library` 或 `openfilm_assets` 补。
- 不猜时长/帧率/编码：从 `openfilm_film` 读到的值就是唯一真值。
