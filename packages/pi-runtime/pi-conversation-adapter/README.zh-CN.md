# @workbench/pi-conversation-adapter

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

将 Pi 消息和事件解析、投影为 Workbench 会话数据。

执行环境：客户端/服务端共享的数据或合同。

## 职责

- 将规范化 Pi 消息组装成 Workbench 会话快照及节点/消息块投影。
- 共享流累积、用量/统计、队列、计时与 Trace 投影。

## 如何导入

```ts
import { PiConversationAssembler } from "@workbench/pi-conversation-adapter/assembler";
import { SessionMessageAccumulator } from "@workbench/pi-conversation-adapter/accumulator";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                           | 入口源码                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `@workbench/pi-conversation-adapter`               | [src/index.ts](./src/index.ts)                                               |
| `@workbench/pi-conversation-adapter/assembler`     | [src/conversation-assembler.ts](./src/conversation-assembler.ts)             |
| `@workbench/pi-conversation-adapter/projection`    | [src/conversation-node-projection.ts](./src/conversation-node-projection.ts) |
| `@workbench/pi-conversation-adapter/model`         | [src/pi-conversation-message.ts](./src/pi-conversation-message.ts)           |
| `@workbench/pi-conversation-adapter/messages`      | [src/messages.ts](./src/messages.ts)                                         |
| `@workbench/pi-conversation-adapter/queue`         | [src/queue.ts](./src/queue.ts)                                               |
| `@workbench/pi-conversation-adapter/events`        | [src/events.ts](./src/events.ts)                                             |
| `@workbench/pi-conversation-adapter/live-tokens`   | [src/live-tokens.ts](./src/live-tokens.ts)                                   |
| `@workbench/pi-conversation-adapter/usage`         | [src/usage.ts](./src/usage.ts)                                               |
| `@workbench/pi-conversation-adapter/statistics`    | [src/statistics.ts](./src/statistics.ts)                                     |
| `@workbench/pi-conversation-adapter/timing`        | [src/timing.ts](./src/timing.ts)                                             |
| `@workbench/pi-conversation-adapter/context-trace` | [src/context-trace.ts](./src/context-trace.ts)                               |
| `@workbench/pi-conversation-adapter/rpc`           | [src/session-rpc-projection.ts](./src/session-rpc-projection.ts)             |
| `@workbench/pi-conversation-adapter/accumulator`   | [src/session-message-accumulator.ts](./src/session-message-accumulator.ts)   |

## 源码导航

| 位置                                                                       | 说明                    |
| -------------------------------------------------------------------------- | ----------------------- |
| [src/conversation-assembler.ts](src/conversation-assembler.ts)             | 会话快照组装            |
| [src/conversation-node-projection.ts](src/conversation-node-projection.ts) | 节点与消息块投影        |
| [src/session-message-accumulator.ts](src/session-message-accumulator.ts)   | 流式消息累积            |
| [lib/live-token-meter.ts](lib/live-token-meter.ts)                         | 实时 Token 估算辅助函数 |

## 边界与接入约定

本包拥有投影算法；会话状态和网络连接生命周期分别归 pi-runtime-client 与 pi-rpc-client。

相关所有者：

- [@workbench/pi-runtime-client](../pi-runtime-client/README.zh-CN.md)
- [@workbench/pi-rpc-client](../pi-rpc-client/README.zh-CN.md)
- [@workbench/agent-runtime-contracts](../../agent-runtime/agent-runtime-contracts/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-conversation-adapter typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
