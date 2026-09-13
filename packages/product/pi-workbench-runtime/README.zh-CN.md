# @workbench/pi-workbench-runtime

[English](README.md) · [Packages](../../README.md) · [Product](../README.md)

Workbench 的 Node 产品能力：自定义 Pi 工具、产品提示与交互规则、内联扩展、默认资源和部署策略。

## 职责

- 自定义 bash、增强搜索、用户询问、设置、工作区审查、Todo、Composer 上下文、Trace 和消息终止。
- 选择默认扩展清单，处理启停与加载结果，保持 Trace 最后安装。
- 拥有产品 Skills、Prompts 和工具许可证，部署内置资源并注册 Browser 包。

## 如何导入

```ts
import { createWorkbenchBashToolOverride } from "@workbench/pi-workbench-runtime/tools/bash";
import { createWorkbenchSettingsExtension } from "@workbench/pi-workbench-runtime/extensions/workbench-settings";
import { createWorkbenchInternalPiExtensions } from "@workbench/pi-workbench-runtime/extensions";
import { ensureWorkbenchBuiltinResources } from "@workbench/pi-workbench-runtime/resources";
import type { WorkbenchToolDependencies } from "@workbench/pi-workbench-runtime/tools/dependencies";
```

本包没有根入口。`/tools` 仅提供扩展结果准备和错误报告；bash 等工具通过独立子路径导入，不由 `/tools` 或 `/tools/builtin-tools` 聚合加载。调用工厂时提供入口类型声明要求的协作者。

## 公开入口

| 导入路径                                                                            | 源码                                                                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@workbench/pi-workbench-runtime/resources`                                         | [src/builtin-resources.ts](./src/builtin-resources.ts)                                                     |
| `@workbench/pi-workbench-runtime/resource-locations`                                | [src/resource-locations.ts](./src/resource-locations.ts)                                                   |
| `@workbench/pi-workbench-runtime/extensions`                                        | [src/extensions.ts](./src/extensions.ts)                                                                   |
| `@workbench/pi-workbench-runtime/builtin-packages`                                  | [src/builtin-packages.ts](./src/builtin-packages.ts)                                                       |
| `@workbench/pi-workbench-runtime/tools/tool-availability`                           | [src/tool-runtime/tool-availability.ts](./src/tool-runtime/tool-availability.ts)                           |
| `@workbench/pi-workbench-runtime/tools/ask-user`                                    | [resources/extensions/ask-user/index.ts](./resources/extensions/ask-user/index.ts)                         |
| `@workbench/pi-workbench-runtime/tools/builtin-tools`                               | [resources/extensions/builtin-tools/index.ts](./resources/extensions/builtin-tools/index.ts)               |
| `@workbench/pi-workbench-runtime/tools/composer-context`                            | [resources/extensions/composer-context/index.ts](./resources/extensions/composer-context/index.ts)         |
| `@workbench/pi-workbench-runtime/tools/context-trace`                               | [resources/extensions/context-trace/index.ts](./resources/extensions/context-trace/index.ts)               |
| `@workbench/pi-workbench-runtime/tools/system-prompt-hook-trace`                    | [src/system-prompt-hook-trace/index.ts](./src/system-prompt-hook-trace/index.ts)                           |
| `@workbench/pi-workbench-runtime/tools/dependencies`                                | [src/tool-runtime/dependencies.ts](./src/tool-runtime/dependencies.ts)                                     |
| `@workbench/pi-workbench-runtime/tools/enhanced-search`                             | [src/tool-runtime/enhanced-search.ts](./src/tool-runtime/enhanced-search.ts)                               |
| `@workbench/pi-workbench-runtime/tools`                                             | [src/tool-runtime/index.ts](./src/tool-runtime/index.ts)                                                   |
| `@workbench/pi-workbench-runtime/tools/message-termination`                         | [resources/extensions/message-termination/index.ts](./resources/extensions/message-termination/index.ts)   |
| `@workbench/pi-workbench-runtime/tools/legacy-message-termination-extension-source` | [src/message-termination/legacy-extension-source.ts](./src/message-termination/legacy-extension-source.ts) |
| `@workbench/pi-workbench-runtime/tools/legacy-message-termination`                  | [src/message-termination/legacy.ts](./src/message-termination/legacy.ts)                                   |
| `@workbench/pi-workbench-runtime/tools/rpiv-todo`                                   | [resources/extensions/rpiv-todo/index.ts](./resources/extensions/rpiv-todo/index.ts)                       |
| `@workbench/pi-workbench-runtime/todo/invariants`                                   | [src/rpiv-todo/invariants.ts](./src/rpiv-todo/invariants.ts)                                               |
| `@workbench/pi-workbench-runtime/todo/replay`                                       | [src/rpiv-todo/replay.ts](./src/rpiv-todo/replay.ts)                                                       |
| `@workbench/pi-workbench-runtime/todo/state-reducer`                                | [src/rpiv-todo/state-reducer.ts](./src/rpiv-todo/state-reducer.ts)                                         |
| `@workbench/pi-workbench-runtime/todo/state`                                        | [src/rpiv-todo/state.ts](./src/rpiv-todo/state.ts)                                                         |
| `@workbench/pi-workbench-runtime/todo/task-graph`                                   | [src/rpiv-todo/task-graph.ts](./src/rpiv-todo/task-graph.ts)                                               |
| `@workbench/pi-workbench-runtime/todo/response-envelope`                            | [src/rpiv-todo/response-envelope.ts](./src/rpiv-todo/response-envelope.ts)                                 |
| `@workbench/pi-workbench-runtime/todo/sanitize`                                     | [src/rpiv-todo/sanitize.ts](./src/rpiv-todo/sanitize.ts)                                                   |
| `@workbench/pi-workbench-runtime/todo/types`                                        | [src/rpiv-todo/types.ts](./src/rpiv-todo/types.ts)                                                         |
| `@workbench/pi-workbench-runtime/tools/workbench-settings`                          | [resources/extensions/workbench-settings/index.ts](./resources/extensions/workbench-settings/index.ts)     |
| `@workbench/pi-workbench-runtime/tools/workspace-review`                            | [resources/extensions/workspace-review/index.ts](./resources/extensions/workspace-review/index.ts)         |
| `@workbench/pi-workbench-runtime/tool-resources`                                    | [src/tool-resources.ts](./src/tool-resources.ts)                                                           |
| `@workbench/pi-workbench-runtime/tools/bash`                                        | [src/bash/index.ts](./src/bash/index.ts)                                                                   |
| `@workbench/pi-workbench-runtime/extensions/ask-user`                               | [resources/extensions/ask-user/index.ts](./resources/extensions/ask-user/index.ts)                         |
| `@workbench/pi-workbench-runtime/extensions/rpiv-todo`                              | [resources/extensions/rpiv-todo/index.ts](./resources/extensions/rpiv-todo/index.ts)                       |
| `@workbench/pi-workbench-runtime/extensions/workbench-settings`                     | [resources/extensions/workbench-settings/index.ts](./resources/extensions/workbench-settings/index.ts)     |
| `@workbench/pi-workbench-runtime/extensions/workspace-review`                       | [resources/extensions/workspace-review/index.ts](./resources/extensions/workspace-review/index.ts)         |
| `@workbench/pi-workbench-runtime/extensions/composer-context`                       | [resources/extensions/composer-context/index.ts](./resources/extensions/composer-context/index.ts)         |
| `@workbench/pi-workbench-runtime/extensions/message-termination`                    | [resources/extensions/message-termination/index.ts](./resources/extensions/message-termination/index.ts)   |
| `@workbench/pi-workbench-runtime/extensions/context-trace`                          | [resources/extensions/context-trace/index.ts](./resources/extensions/context-trace/index.ts)               |
| `@workbench/pi-workbench-runtime/extensions/builtin-tools`                          | [resources/extensions/builtin-tools/index.ts](./resources/extensions/builtin-tools/index.ts)               |

## 源码导航

每个自定义工具在 `src/` 下独占目录：`bash`、`ask-user`、`grep`、`find`、`rpiv-todo`、`workbench-settings` 和 `workspace-review`。专属辅助实现、来源说明与许可证和工具共置；`tool-runtime` 仅放共享装配，上下文、Trace、终止等 Hook 各自按能力归档。`resources/` 仅承载 Pi 资源类型（当前为 `extensions`、`skills`、`prompts`），Todo 的 README 与 MIT 许可证归 `src/rpiv-todo/`。测试仍按仓库规范放在包根 `tests/`。

| 位置                                                 | 内容                           |
| ---------------------------------------------------- | ------------------------------ |
| [src](src)                                           | 产品工具执行与共享投影逻辑     |
| [src/rpiv-todo](src/rpiv-todo)                       | Todo 状态机、重放与校验        |
| [src/extensions.ts](src/extensions.ts)               | 默认扩展选择与安装顺序         |
| [src/tool-resources.ts](src/tool-resources.ts)       | 工具源码快照白名单与位置       |
| [src/builtin-resources.ts](src/builtin-resources.ts) | 内置资源部署与兼容清理         |
| [resources/extensions](resources/extensions)         | Pi 扩展注册与生命周期入口      |
| [resources/skills](resources/skills)                 | 产品 Skills                    |
| [resources/prompts](resources/prompts)               | 产品 Prompts                   |
| [src/rpiv-todo/LICENSE](src/rpiv-todo/LICENSE)       | 工具来源说明和 MIT 许可证      |
| [lib](lib)                                           | 被工具和部署实现消费的辅助逻辑 |

## 边界与装配

扩展注册位于 `resources/extensions/<name>/index.ts`；工具参数、执行、状态与结果处理留在 `src/<tool-name>/`。扩展工厂优先从 `/extensions/<name>` 导入。原有 8 个混合工具/扩展 `/tools/<name>` 入口保留既有符号，并解析到相同资源模块；此前 29 个入口全部继续可用，当前共 37 个入口。`src/extensions.ts` 静态导入资源并注入宿主依赖，保留顺序与启停规则，不再额外通过文件发现加载这些宿主扩展。详见[扩展资源说明](resources/extensions/README.zh-CN.md)。

产品包拥有具体工具实现及其产品规则。通用 PTY、终端会话与原生依赖仍归 terminal-server；Git 与工作区能力仍归 workspace-server；SDK 会话、模型与资源加载仍归 pi-sdk。

Runtime 装配层注入 Host、Trace、设置和共享终端会话管理器。SDK 会话通过 PiSessionRuntimeDependencies 接收工具覆盖选择和审查解析回调，SDK 不导入本产品包。产品包也不导入 React、前端产品或 pi-runtime-server。

Browser 是可供独立 Pi CLI 使用的完整 Pi Package，继续保留 pi-runtime-browser；本产品选择其默认安装。`/resources` 负责部署，`/tool-resources` 只描述工具源码快照。构建器和开发部署共用白名单，避免将 Skills/Prompts 或产品部署实现重复复制到 internal-extensions。

保持工具名称、workbench.terminal 等来源标识、扩展 ID、参数、提示、输出预算、取消、启停状态和持久化格式。产物根路径 internal-skills/internal-prompts/internal-extensions/internal-packages/browser 与 .builtin 位置保持；工具快照源码现在位于各自的 `src/<tool-name>/` 目录，仅精确退役已迁移的官方平铺文件，未知文件保留。

## 相关能力

- [terminal-server](../../terminal/terminal-server/README.zh-CN.md)
- [workspace-server](../../server/workspace-server/README.zh-CN.md)
- [pi-sdk-sessions](../../pi-sdk/pi-sdk-sessions/README.zh-CN.md)
- [pi-sdk-resources](../../pi-sdk/pi-sdk-resources/README.zh-CN.md)
- [pi-runtime-browser](../../pi-runtime/pi-runtime-browser/README.zh-CN.md)
- [pi-runtime-server](../../pi-runtime/pi-runtime-server/README.zh-CN.md)

## 验证

```bash
pnpm --filter @workbench/pi-workbench-runtime typecheck
pnpm --filter @workbench/pi-workbench-runtime test
```

[Spec011 计划与验证](../../../specs/011-product-tool-ownership/plan.md)。本期只执行非 UI 逻辑、类型、结构、依赖和构建检查，不运行 UI 渲染或交互测试。
