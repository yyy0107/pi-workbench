# @workbench/pi-rpc-contracts

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

客户端与服务端共享的可序列化 Pi Runtime 合同。

执行环境：客户端/服务端共享的数据或合同。

## 职责

- 定义附件元数据、Pi 消息、RPC 载荷与流帧封装。
- 提供传输边界使用的流载荷守卫与校验辅助函数。

## 如何导入

```ts
import type { SessionEventPayload } from "@workbench/pi-rpc-contracts/stream";
import { STREAM_PATHS } from "@workbench/pi-rpc-contracts/stream";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

本包没有根入口，必须选择下表中的子路径。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                  | 入口源码                                   |
| ----------------------------------------- | ------------------------------------------ |
| `@workbench/pi-rpc-contracts/attachments` | [src/attachments.ts](./src/attachments.ts) |
| `@workbench/pi-rpc-contracts/messages`    | [src/messages.ts](./src/messages.ts)       |
| `@workbench/pi-rpc-contracts/rpc`         | [src/rpc.ts](./src/rpc.ts)                 |
| `@workbench/pi-rpc-contracts/stream`      | [src/stream.ts](./src/stream.ts)           |

## 源码导航

| 位置                                                 | 说明          |
| ---------------------------------------------------- | ------------- |
| [src/rpc.ts](src/rpc.ts)                             | 请求/响应载荷 |
| [src/stream.ts](src/stream.ts)                       | 流帧与守卫    |
| [src/messages.ts](src/messages.ts)                   | Pi 消息合同   |
| [lib/stream-validation.ts](lib/stream-validation.ts) | 校验辅助函数  |

## 边界与接入约定

线协议合同传递 JSON 安全数据。序列化载荷不得携带 SDK 会话对象、回调、凭据存储、文件句柄或 React 状态。

相关所有者：

- [@workbench/pi-rpc-client](../pi-rpc-client/README.zh-CN.md)
- [@workbench/pi-runtime-server](../pi-runtime-server/README.zh-CN.md)
- [@workbench/pi-sdk-ports](../../pi-sdk/pi-sdk-ports/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-rpc-contracts typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
