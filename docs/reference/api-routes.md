<!-- doc
id: reference-api-routes
reader: 写/审路由的人
fact-source: src/*.mjs、index.js 里的 path 注册（scripts/gen-docs.mjs 生成）
checked: generated
rot-if: 新增或删除任何 /api 路由（重新生成即可）
-->

# HTTP 路由（自动生成）

> 生成命令：`npm run docs:gen`。共 **17** 条。**不要手改**——改了也会被 `--check` 判为过期。
> 方法列来自 handler 里的 `request.method` 判断，可能不完整；镜像路由（如代理）不在此表。

## /api/no996-openfilm/

| 方法 | 路径 | 类型 | 处理位置 |
|---|---|---|---|
| POST | `/api/no996-openfilm/archive` | exact | `src/archive-bridge.mjs:16` |
| POST | `/api/no996-openfilm/asr` | exact | `src/studio-controller.mjs:740` |
| GET/HEAD/POST | `/api/no996-openfilm/attachment` | exact | `src/studio-controller.mjs:1020` |
| POST | `/api/no996-openfilm/auth` | exact | `src/auth-bridge.mjs:95` |
| POST | `/api/no996-openfilm/bootstrap` | exact | `src/studio-controller.mjs:1070` |
| POST | `/api/no996-openfilm/client-log` | exact | `src/studio-controller.mjs:1044` |
| POST | `/api/no996-openfilm/debug-url` | exact | `src/studio-controller.mjs:1420` |
| POST | `/api/no996-openfilm/diagnose` | exact | `src/studio-controller.mjs:949` |
| POST | `/api/no996-openfilm/editing-archive` | exact | `src/studio-controller.mjs:1238` |
| POST | `/api/no996-openfilm/editing-delete` | exact | `src/studio-controller.mjs:1277` |
| GET/POST | `/api/no996-openfilm/editing-delete-project` | exact | `src/studio-controller.mjs:1322` |
| POST | `/api/no996-openfilm/editing-prefs` | exact | `src/studio-controller.mjs:1213` |
| GET | `/api/no996-openfilm/editing-sessions` | exact | `src/studio-controller.mjs:1130` |
| POST | `/api/no996-openfilm/mcp` | exact | `src/studio-controller.mjs:1395` |
| POST | `/api/no996-openfilm/system/check` | exact | `src/studio-controller.mjs:802` |
| POST | `/api/no996-openfilm/system/install` | exact | `src/studio-controller.mjs:814` |
| POST | `/api/no996-openfilm/templates` | exact | `src/template-bridge.mjs:8` |

