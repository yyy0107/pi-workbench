# @workbench/pi-rpc-client

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Pi HTTP/RPC 客户端操作与配对 WebSocket 连接管理。

执行环境：浏览器传输层（支持注入以执行非 UI 测试）。

## 职责

- 捕获安装实例的传输函数，避免把运行时状态绑定到应用连接对象。
- 管理 mux/host 连接代际、重连、就绪、水位与流帧校验。
- 实体化流式消息时复用会话适配器的累积器。

## 如何导入

```ts
import { PiConnectionController, snapshotPiClientTransport } from "@workbench/pi-rpc-client";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                               | 入口源码                                   |
| -------------------------------------- | ------------------------------------------ |
| `@workbench/pi-rpc-client`             | [src/index.ts](./src/index.ts)             |
| `@workbench/pi-rpc-client/api`         | [src/api.ts](./src/api.ts)                 |
| `@workbench/pi-rpc-client/connections` | [src/connections.ts](./src/connections.ts) |

## 源码导航

| 位置                                                     | 说明                    |
| -------------------------------------------------------- | ----------------------- |
| [src/api.ts](src/api.ts)                                 | Pi RPC 操作与客户端错误 |
| [src/client-transport.ts](src/client-transport.ts)       | 传输快照合同            |
| [src/connections.ts](src/connections.ts)                 | 配对连接生命周期        |
| [lib/stream-frame-parser.ts](lib/stream-frame-parser.ts) | 流帧解析                |

## 边界与接入约定

应用通常安装 pi-runtime-client 或 pi-workbench；直接使用传输层时，应共享唯一连接 owner，并随安装实例释放。

相关所有者：

- [@workbench/pi-runtime-client](../pi-runtime-client/README.zh-CN.md)
- [@workbench/pi-rpc-contracts](../pi-rpc-contracts/README.zh-CN.md)
- [@workbench/pi-conversation-adapter](../pi-conversation-adapter/README.zh-CN.md)
- [@workbench/api](../../transport/api/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-rpc-client typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
