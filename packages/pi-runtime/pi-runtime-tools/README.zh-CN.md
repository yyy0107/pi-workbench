# @workbench/pi-runtime-tools

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Workbench 专属的 Pi 工具工厂与扩展执行适配。

执行环境：Node.js / 服务端。

## 职责

- 实现设置、工作区审查、Todo、用户询问、Composer 上下文、Trace 和消息终止行为。
- 提供基础工具定义/覆盖、启停处理和有界结构化工具结果。
- 准备已加载扩展结果，保留用户扩展与共享 SDK runtime。

## 如何导入

```ts
import { prepareWorkbenchPiExtensions } from "@workbench/pi-runtime-tools";
import { createWorkbenchSettingsExtension } from "@workbench/pi-runtime-tools/workbench-settings";
import type { WorkbenchToolDependencies } from "@workbench/pi-runtime-tools/dependencies";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                                                  | 入口源码                                                                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@workbench/pi-runtime-tools/tool-availability`                           | [src/tool-availability.ts](./src/tool-availability.ts)                                                     |
| `@workbench/pi-runtime-tools/ask-user`                                    | [src/ask-user.ts](./src/ask-user.ts)                                                                       |
| `@workbench/pi-runtime-tools/builtin-tools`                               | [src/builtin-tools.ts](./src/builtin-tools.ts)                                                             |
| `@workbench/pi-runtime-tools/composer-context`                            | [src/composer-context.ts](./src/composer-context.ts)                                                       |
| `@workbench/pi-runtime-tools/context-trace`                               | [src/context-trace.ts](./src/context-trace.ts)                                                             |
| `@workbench/pi-runtime-tools/system-prompt-hook-trace`                    | [src/system-prompt-hook-trace.ts](./src/system-prompt-hook-trace.ts)                                       |
| `@workbench/pi-runtime-tools/dependencies`                                | [src/dependencies.ts](./src/dependencies.ts)                                                               |
| `@workbench/pi-runtime-tools/enhanced-search`                             | [src/enhanced-search.ts](./src/enhanced-search.ts)                                                         |
| `@workbench/pi-runtime-tools`                                             | [src/index.ts](./src/index.ts)                                                                             |
| `@workbench/pi-runtime-tools/message-termination`                         | [src/message-termination.ts](./src/message-termination.ts)                                                 |
| `@workbench/pi-runtime-tools/legacy-message-termination-extension-source` | [src/legacy-message-termination-extension-source.ts](./src/legacy-message-termination-extension-source.ts) |
| `@workbench/pi-runtime-tools/legacy-message-termination`                  | [src/legacy-message-termination.ts](./src/legacy-message-termination.ts)                                   |
| `@workbench/pi-runtime-tools/rpiv-todo`                                   | [src/rpiv-todo.ts](./src/rpiv-todo.ts)                                                                     |
| `@workbench/pi-runtime-tools/invariants`                                  | [src/todo/invariants.ts](./src/todo/invariants.ts)                                                         |
| `@workbench/pi-runtime-tools/replay`                                      | [src/todo/replay.ts](./src/todo/replay.ts)                                                                 |
| `@workbench/pi-runtime-tools/state-reducer`                               | [src/todo/state-reducer.ts](./src/todo/state-reducer.ts)                                                   |
| `@workbench/pi-runtime-tools/state`                                       | [src/todo/state.ts](./src/todo/state.ts)                                                                   |
| `@workbench/pi-runtime-tools/task-graph`                                  | [src/todo/task-graph.ts](./src/todo/task-graph.ts)                                                         |
| `@workbench/pi-runtime-tools/response-envelope`                           | [src/response-envelope.ts](./src/response-envelope.ts)                                                     |
| `@workbench/pi-runtime-tools/sanitize`                                    | [src/sanitize.ts](./src/sanitize.ts)                                                                       |
| `@workbench/pi-runtime-tools/types`                                       | [src/todo/types.ts](./src/todo/types.ts)                                                                   |
| `@workbench/pi-runtime-tools/workbench-settings`                          | [src/workbench-settings.ts](./src/workbench-settings.ts)                                                   |
| `@workbench/pi-runtime-tools/workspace-review`                            | [src/workspace-review.ts](./src/workspace-review.ts)                                                       |
| `@workbench/pi-runtime-tools/resources`                                   | [src/resources.ts](./src/resources.ts)                                                                     |

## 源码导航

| 位置                                                               | 说明                         |
| ------------------------------------------------------------------ | ---------------------------- |
| [src/index.ts](src/index.ts)                                       | 结果准备与限定范围的错误报告 |
| [src/dependencies.ts](src/dependencies.ts)                         | 注入的 Workbench 协作合同    |
| [src/builtin-tools.ts](src/builtin-tools.ts)                       | SDK 定义与 Workbench 覆盖    |
| [src/workbench-settings.ts](src/workbench-settings.ts)             | 设置工具实现                 |
| [src/rpiv-todo.ts](src/rpiv-todo.ts)                               | Todo 扩展工厂                |
| [lib/system-prompt-hook-trace.ts](lib/system-prompt-hook-trace.ts) | Hook Trace 辅助函数          |

## 边界与接入约定

默认扩展清单由 pi-workbench-runtime/extensions 选择；本包根入口导出准备/错误处理，不导出 createWorkbenchInternalPiExtensions。

工厂接收 WorkbenchToolDependencies，不导入 Host 全局对象、会话注册表或 StreamHub。保持工具 ID、输出预算、启停与释放行为。

resources/ 保存工具归属说明和配套资源；产品 Skills 与 Prompts 归 pi-workbench-runtime。

相关所有者：

- [@workbench/pi-workbench-runtime](../../product/pi-workbench-runtime/README.zh-CN.md)
- [@workbench/pi-runtime-server](../pi-runtime-server/README.zh-CN.md)
- [@workbench/pi-sdk-ports](../../pi-sdk/pi-sdk-ports/README.zh-CN.md)
- [@workbench/pi-runtime-terminal](../pi-runtime-terminal/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-runtime-tools typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
