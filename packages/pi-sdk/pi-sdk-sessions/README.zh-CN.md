# @workbench/pi-sdk-sessions

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

受托管 Pi 会话的生命周期、执行、历史与持久化服务。

执行环境：Node.js / 服务端。

## 职责

- 创建会话注册表，使用 Pi SDK services 启动或恢复托管会话。
- 拥有执行、队列、日志、历史、附件、导入、用量以及面向会话的自动化能力。
- 保留唯一进程状态图、HMR 接管路径、Scratch 过期生命周期和串行变更/fork 队列。

## 如何导入

```ts
import { createPiSessionRegistry } from "@workbench/pi-sdk-sessions/registry";
import type { PiSessionRuntimeDependencies } from "@workbench/pi-sdk-sessions/session-runtime-dependencies";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

本包没有根入口，必须选择下表中的子路径。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                                     | 入口源码                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `@workbench/pi-sdk-sessions/cold-session-event-cache`        | [src/cold-session-event-cache.ts](./src/cold-session-event-cache.ts)                 |
| `@workbench/pi-sdk-sessions/composer-conversation-context`   | [src/composer-conversation-context.ts](./src/composer-conversation-context.ts)       |
| `@workbench/pi-sdk-sessions/composer-workspace-file-context` | [src/composer-workspace-file-context.ts](./src/composer-workspace-file-context.ts)   |
| `@workbench/pi-sdk-sessions/inline-image-admission`          | [src/inline-image-admission.ts](./src/inline-image-admission.ts)                     |
| `@workbench/pi-sdk-sessions/interactive`                     | [src/interactive-response-registry.ts](./src/interactive-response-registry.ts)       |
| `@workbench/pi-sdk-sessions/scratch`                         | [src/pi-scratch-session-store.ts](./src/pi-scratch-session-store.ts)                 |
| `@workbench/pi-sdk-sessions/context-trace`                   | [src/pi-session-context-trace-service.ts](./src/pi-session-context-trace-service.ts) |
| `@workbench/pi-sdk-sessions/history`                         | [src/pi-session-history-service.ts](./src/pi-session-history-service.ts)             |
| `@workbench/pi-sdk-sessions/model-context`                   | [src/pi-session-model-context-service.ts](./src/pi-session-model-context-service.ts) |
| `@workbench/pi-sdk-sessions/protocol`                        | [src/pi-session-protocol-facade.ts](./src/pi-session-protocol-facade.ts)             |
| `@workbench/pi-sdk-sessions/session-catalog-index`           | [src/session-catalog-index.ts](./src/session-catalog-index.ts)                       |
| `@workbench/pi-sdk-sessions/session-context-breakdown`       | [src/session-context-breakdown.ts](./src/session-context-breakdown.ts)               |
| `@workbench/pi-sdk-sessions/session-context-policy`          | [src/session-context-policy.ts](./src/session-context-policy.ts)                     |
| `@workbench/pi-sdk-sessions/session-context-trace-journal`   | [src/session-context-trace-journal.ts](./src/session-context-trace-journal.ts)       |
| `@workbench/pi-sdk-sessions/session-context-trace-summary`   | [src/session-context-trace-summary.ts](./src/session-context-trace-summary.ts)       |
| `@workbench/pi-sdk-sessions/session-context-trace`           | [src/session-context-trace.ts](./src/session-context-trace.ts)                       |
| `@workbench/pi-sdk-sessions/session-event-journal`           | [src/session-event-journal.ts](./src/session-event-journal.ts)                       |
| `@workbench/pi-sdk-sessions/export`                          | [src/session-export.ts](./src/session-export.ts)                                     |
| `@workbench/pi-sdk-sessions/session-initial-model`           | [src/session-initial-model.ts](./src/session-initial-model.ts)                       |
| `@workbench/pi-sdk-sessions/session-interruption`            | [src/session-interruption.ts](./src/session-interruption.ts)                         |
| `@workbench/pi-sdk-sessions/session-queue`                   | [src/session-queue.ts](./src/session-queue.ts)                                       |
| `@workbench/pi-sdk-sessions/registry`                        | [src/session-registry.ts](./src/session-registry.ts)                                 |
| `@workbench/pi-sdk-sessions/session-resume`                  | [src/session-resume.ts](./src/session-resume.ts)                                     |
| `@workbench/pi-sdk-sessions/session-rpc-service`             | [src/session-rpc-service.ts](./src/session-rpc-service.ts)                           |
| `@workbench/pi-sdk-sessions/session-runtime-dependencies`    | [src/session-runtime-dependencies.ts](./src/session-runtime-dependencies.ts)         |
| `@workbench/pi-sdk-sessions/system-prompt-placeholders`      | [src/system-prompt-placeholders.ts](./src/system-prompt-placeholders.ts)             |
| `@workbench/pi-sdk-sessions/usage-statistics-aggregation`    | [src/usage-statistics-aggregation.ts](./src/usage-statistics-aggregation.ts)         |
| `@workbench/pi-sdk-sessions/usage-statistics-store`          | [src/usage-statistics-store.ts](./src/usage-statistics-store.ts)                     |
| `@workbench/pi-sdk-sessions/usage`                           | [src/usage-statistics.ts](./src/usage-statistics.ts)                                 |
| `@workbench/pi-sdk-sessions/composer-text-attachments`       | [src/composer-text-attachments.ts](./src/composer-text-attachments.ts)               |
| `@workbench/pi-sdk-sessions/claude-code-session-importer`    | [src/claude-code-session-importer.ts](./src/claude-code-session-importer.ts)         |
| `@workbench/pi-sdk-sessions/codex-session-importer`          | [src/codex-session-importer.ts](./src/codex-session-importer.ts)                     |
| `@workbench/pi-sdk-sessions/cursor-session-importer`         | [src/cursor-session-importer.ts](./src/cursor-session-importer.ts)                   |
| `@workbench/pi-sdk-sessions/imports`                         | [src/external-session-import-service.ts](./src/external-session-import-service.ts)   |
| `@workbench/pi-sdk-sessions/external-session-types`          | [src/external-session-types.ts](./src/external-session-types.ts)                     |
| `@workbench/pi-sdk-sessions/source-utils`                    | [src/source-utils.ts](./src/source-utils.ts)                                         |
| `@workbench/pi-sdk-sessions/automation`                      | [src/pi-automation-service.ts](./src/pi-automation-service.ts)                       |
| `@workbench/pi-sdk-sessions/execution`                       | [src/pi-agent-execution.ts](./src/pi-agent-execution.ts)                             |
| `@workbench/pi-sdk-sessions/threads`                         | [src/pi-agent-thread-store.ts](./src/pi-agent-thread-store.ts)                       |

## 源码导航

| 位置                                                                     | 说明                      |
| ------------------------------------------------------------------------ | ------------------------- |
| [src/session-registry.ts](src/session-registry.ts)                       | 注册表门面与 SDK 会话创建 |
| [src/hosted-pi-session.ts](src/hosted-pi-session.ts)                     | 活跃会话、事件与队列协调  |
| [src/session-registry-state.ts](src/session-registry-state.ts)           | 进程状态与 HMR 保留       |
| [src/persisted-session-directory.ts](src/persisted-session-directory.ts) | 持久化会话目录            |
| [src/scratch-session-directory.ts](src/scratch-session-directory.ts)     | Scratch 会话与过期        |
| [src/session-projections.ts](src/session-projections.ts)                 | 共享历史与恢复投影        |
| [lib/session-queue.ts](lib/session-queue.ts)                             | 队列辅助函数              |

## 边界与接入约定

通过服务端装配层在每个模块代际创建一个注册表。PiSessionRuntimeDependencies 注入 Host、发布器、工作区访问、资源安装与扩展创建/准备。

产品默认值由包外选择。注册表调用方复用既有 owner，不重复创建 SDK 会话、锁、缓存或清理钩子。

相关所有者：

- [@workbench/pi-runtime-server](../../pi-runtime/pi-runtime-server/README.zh-CN.md)
- [@workbench/pi-sdk-models](../pi-sdk-models/README.zh-CN.md)
- [@workbench/pi-workbench-runtime](../../product/pi-workbench-runtime/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-sdk-sessions typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
