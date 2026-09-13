# @workbench/pi-runtime-client

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

浏览器侧的 Pi Workbench AgentRuntime 实现及能力 API。

执行环境：浏览器 / React。

## 职责

- 安装一个 Pi Runtime，对外提供有限的 Host、工作区、模型、会话和交互能力。
- 协调会话目录、规范历史、附件准备、队列和实时会话状态。
- 适配 Pi 专属错误，通过明确入口提供配置、资源、Trace、用量与导入 API。

## 如何导入

```ts
import { createPiAgentRuntimeInstallation } from "@workbench/pi-runtime-client/installation";
import type { PiAgentRuntimeInstallationOptions } from "@workbench/pi-runtime-client/installation";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

本包没有根入口，必须选择下表中的子路径。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                        | 入口源码                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `@workbench/pi-runtime-client/usage-statistics` | [src/public/usage-statistics.ts](./src/public/usage-statistics.ts) |
| `@workbench/pi-runtime-client/installation`     | [src/public/installation.tsx](./src/public/installation.tsx)       |
| `@workbench/pi-runtime-client/errors`           | [src/public/errors.ts](./src/public/errors.ts)                     |
| `@workbench/pi-runtime-client/host`             | [src/public/host.ts](./src/public/host.ts)                         |
| `@workbench/pi-runtime-client/resources`        | [src/public/resources.ts](./src/public/resources.ts)               |
| `@workbench/pi-runtime-client/configuration`    | [src/public/configuration.ts](./src/public/configuration.ts)       |
| `@workbench/pi-runtime-client/workspace`        | [src/public/workspace.ts](./src/public/workspace.ts)               |
| `@workbench/pi-runtime-client/external-import`  | [src/public/external-import.ts](./src/public/external-import.ts)   |
| `@workbench/pi-runtime-client/context-trace`    | [src/public/context-trace.ts](./src/public/context-trace.ts)       |

## 源码导航

| 位置                                                                                       | 说明               |
| ------------------------------------------------------------------------------------------ | ------------------ |
| [src/public/installation.tsx](src/public/installation.tsx)                                 | 公开安装入口       |
| [src/integration/pi-runtime-installation.tsx](src/integration/pi-runtime-installation.tsx) | 安装与依赖绑定     |
| [src/runtime/manager.ts](src/runtime/manager.ts)                                           | Runtime 编排       |
| [src/runtime/manager-catalog.ts](src/runtime/manager-catalog.ts)                           | 目录状态 owner     |
| [src/runtime/session.ts](src/runtime/session.ts)                                           | 单会话编排         |
| [src/runtime/session-history.ts](src/runtime/session-history.ts)                           | 规范历史 owner     |
| [src/runtime/session-attachments.ts](src/runtime/session-attachments.ts)                   | 附件生命周期 owner |
| [lib/fork-title.ts](lib/fork-title.ts)                                                     | Fork 标题辅助函数  |

## 边界与接入约定

Manager 绑定有限的 PiClientSessionDependencies 合同；Session 不接收整个 Manager。目录、历史和附件各有专属 owner，并共享同一权威状态图。

传输归 pi-rpc-client，消息投影归 pi-conversation-adapter；本包没有可供导入的 transport/ 或 conversation/ 所有权目录。

Workbench 设置客户端来自 services-client/settings，由 pi-workbench 装配；本包不公开 workbench-settings 入口。

保留稳定的 Node/Block 引用以及既有微任务、动画帧与终态发布时机。通用 UI 消费 Workbench 能力，不读取 Pi 协议对象。

相关所有者：

- [@workbench/pi-rpc-client](../pi-rpc-client/README.zh-CN.md)
- [@workbench/pi-conversation-adapter](../pi-conversation-adapter/README.zh-CN.md)
- [@workbench/pi-workbench](../../product/pi-workbench/README.zh-CN.md)
- [@workbench/agent-runtime-client](../../agent-runtime/agent-runtime-client/README.zh-CN.md)
- [@workbench/services-client](../../client/services-client/README.zh-CN.md)

```text
Pi transport / history → PiClientSession + focused state owners
                      → PiConversationAssembler
                      → Workbench ConversationSnapshot + Node/Block observables
```

## 维护与验证

```bash
pnpm --filter @workbench/pi-runtime-client typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
