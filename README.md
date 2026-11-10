# dsh-openfilm

OpenFilm 视频创作作为 DSH 插件：整页官方 Studio 0.3.1 + 官方对话列，对话经 Host 桥到 DSH 会话。

## 下载方式

**方式一（推荐）：直接拿打包好的插件包**

```
dist/dsh-openfilm-0.1.6.tgz
```

下载后在你的 DSH 工作区安装：

```sh
pnpm add /path/to/dsh-openfilm-0.1.6.tgz
# 或 npm i /path/to/dsh-openfilm-0.1.6.tgz
```

**方式二：克隆源码**

```sh
git clone https://github.com/NewbieCheng/dsh-openfilm.git
cd dsh-openfilm && pnpm install
```

两种方式装好后，都在 DSH profile 里挂上插件：

```yaml
- insert:
    - id: dsh-openfilm
      name: 'dsh-openfilm'
```

重启 DSH，侧边栏出现「视频创作」。
```sh
git clone https://github.com/NewbieCheng/dsh-openfilm.git
cd dsh-openfilm
pnpm install
```

然后在你的 DSH profile patch 里挂上这个包（`cordis.patch.yml` 已给出 `insert` 形式）：

```yaml
- insert:
    - id: dsh-openfilm
      name: 'dsh-openfilm'
```

重启 DSH 后，侧边栏出现「视频创作」。

## 需要什么

- DSH 内核（含 `session-controller`、`storageDomain`、`webServer`）
- Node.js 20+
- 首次打开会启动官方 Studio（随包内置构建产物，端口固定 47822/47821）

## 能力与边界

- 官方对话与 DSH 会话绑定：发消息、流式回复、模型选择、取消、参考图
- 审批不经过本插件（走 DSH 自身界面），不会被静默放行
- skills / 截图 / 撤销仍未接通（fail closed）

## 许可

本仓库为接入代码（MIT）。官方 OpenFilm 的构建产物与许可证见 `vendor/official-shell/`。
---

# DSH video studio (in development)

This package is an early DSH-native plugin. A local Host-side bridge displays the original OpenFilm Studio beside an embedded DSH conversation. The earlier global-conversation UI was confirmed visible; the per-project conversation, route bridge, contextual manual and resizable panel are implemented in source but have not yet been exercised in the live UI. The pre-existing global video conversation is not deleted or automatically assigned to a project.

A project's conversation is resolved by `project-conversation.mjs`: the Host asks Studio for the canonical project directory, reuses the previously mapped DSH Session when that Session still exists with the same cwd, and otherwise creates a new empty Session. The mapping is only a hint: a failed hint write is not an error and a lost hint opens a new conversation, so there is no pending state and no unrecoverable project error. Nothing is deleted or reassigned. `project-sessions.mjs` (the former two-phase registry) is retained but no longer used; its old records are left untouched. `openfilm_guide` reads the pinned upstream package's manuals for project Sessions; the existing `openfilm_draft` Agent tool remains a pure, in-memory operation. Sending messages, project-aware edits, preview, and export have not yet been verified. The upstream Studio runtime uses its own file and process permissions; DSH workspace tool sandbox policies do not constrain it. OpenFilm's text-only `askAgent` integration is wired to the DSH default model in source; image, video and audio generation are not bridged to DSH. Some Studio routes and representations are restricted by the bridge; full feature compatibility, preview and export remain unverified.

## Official desktop Chat integration (stage 1: shell served, Agent not yet bridged)

The pinned OpenFilm 0.3.1 desktop shell is built separately from its matching official source and packaged into `vendor/official-shell/ui`. `scripts/build-official-shell.mjs` checks the source checkout's exact commit and records asset hashes; it packages a previously built shell and does **not** establish build provenance or download dependencies. The generated manifest includes OpenFilm's license and upstream notices. Review the bundled third-party licenses before distribution: the upstream notice is short and does not carry the full React / Inter / Lexical texts.

By default the video panel now serves that official shell, whose own chat column replaces the DSH conversation beside Studio. Set `NO996_OPENFILM_DSH_CHAT=1` before the Host starts to fall back to the embedded DSH conversation. Stage 1 status:

- The shell's preload facade (`src/official-facade.mjs`) supplies layout, theme, preferences and project-scoped chat persistence; the project chat store (`src/official-chat-store.mjs`) lives in its own DSH storage domain with a revision guard, and never reads or deletes upstream `.film/chat` history.
- User-picked files upload through Studio's own import endpoint (`assets/upload/…`); nothing writes project files through Node directly.
- The official chat sends through the Host: `localAgents.start/prompt/cancel/setOption` map to a project's DSH Session via `/__dsh/official-rpc`, and assistant deltas stream back over `/__dsh/official-events` (SSE). Model choices come from the Host catalog; reference images are forwarded as typed image parts and re-validated by the Host. Approvals stay with DSH's own UI: this plugin has no pending-interaction subscription, so a tool that needs approval is answered there and never auto-allowed. Skills, screenshots and undo still fail closed.
- Trust model: the editor origin is treated as the official OpenFilm window for this local user, matching upstream's own desktop trust model. Project IDs are still validated against Studio's live project list. A signed per-frame scope (`official-project-scope.mjs`) can tighten this later.

## Upstream updates

The production Studio runtime is the official OpenFilm npm release declared by the exact tarball URL in `package.json`; `studio-runtime.mjs` derives its expected version from that one declaration. Update that URL to a newer official release only after reviewing its release notes, `openfilm/studio` export and `startStudio` contract, authentication/origin behavior, Node and Chromium requirements, and third-party licenses. Rebuild and verify the integration before distribution; do not silently install `latest` at runtime. The local draft/summary implementation and vendored `film-doc.mjs` are temporary compatibility code and do not automatically update with the package; review or remove them when the original Studio takes over the UI.

## Upstream provenance

`vendor/film-doc.mjs` is an unmodified copy of `packages/openfilm/src/film-doc.mjs` from [OpenFilm](https://github.com/openfilm/openfilm), commit `a85a80a9742981f0f77f61df88a2780984f8f3fb`, package version 0.3.1. Its SHA-256 is `030a3c1a8271ca47906a12af895bbbbeeb7e3c875baa98f2c8621c1837369e4a`. Its MIT license is included as `vendor/LICENSE`. OpenFilm's trademark, other third-party components, assets and media-provider terms require separate review before distribution.

`src/project-core.mjs` is an isolated local experiment; it is **not** registered by the plugin. Its cooperative lock is not an atomic compare-and-swap against external writers, nor is its Node filesystem a substitute for DSH's sandbox. Do not connect it to the UI or tools as an authorization boundary. A DSH filesystem-backed service and a clear conflict and isolation model are needed first.

Upstream film pages may contain arbitrary executable HTML/JavaScript. Do not execute them in the DSH origin or assume the upstream local server/renderer confines network, files or projects. No render sandbox is implemented.


