<!-- doc
id: reference-env-vars
reader: 部署者、排查问题的人
fact-source: src/*.mjs、index.js 里的 process.env 读取（scripts/gen-docs.mjs 生成）
checked: generated
rot-if: 新增/删除环境变量（重新生成即可）
-->

# 环境变量（自动生成）

> 生成命令：`npm run docs:gen`。共 **9** 个。表格只列"代码读了什么"，用途以 AGENTS.md §6 与各模块注释为准。

| 变量 | 读取次数 | 位置 |
|---|---|---|
| `DSH_HOME` | 8 | `src/login-remember.mjs`、`src/preferences.mjs`、`src/studio-controller.mjs`、`src/studio-controller/routes/assets.mjs`、`src/tool-installer.mjs`、`src/workbench-auth.mjs` |
| `NO996_OPENFILM_CLI` | 1 | `src/cli-tool.mjs` |
| `NO996_OPENFILM_DEBUG_PORT` | 3 | `src/studio-controller.mjs`、`src/studio-debug-redirect.mjs`、`src/studio-debug.mjs` |
| `NO996_OPENFILM_DEV` | 2 | `src/studio-controller.mjs`、`src/workbench-auth.mjs` |
| `NO996_OPENFILM_DSH_CHAT` | 1 | `index.js` |
| `NO996_OPENFILM_EDITOR_PORT` | 2 | `src/studio-controller.mjs`、`src/studio-proxy.mjs` |
| `NO996_OPENFILM_KEEP_V4_FLASH` | 1 | `src/acp-agent-service.mjs` |
| `NO996_WORKBENCH_BASE_URL` | 1 | `src/workbench-auth.mjs` |
| `OPENFILM_LIBRARY_URL` | 1 | `src/studio-runtime.mjs` |

