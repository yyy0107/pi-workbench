# @workbench/runtime-transport-client

[English](README.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

Runtime HTTP 与 WebSocket 的客户端传输载体。根据调用方提供的 RuntimeConnection 解析地址、携带认证信息并完成 WebSocket 认证握手；适用于浏览器，也可在测试中注入载体。

## 如何导入

```ts
import { callRpc } from "@workbench/api/client";
import { createRuntimeFetch } from "@workbench/runtime-transport-client/runtime-fetch";
import { createRuntimeWebSocket } from "@workbench/runtime-transport-client/runtime-websocket";
```

以上仅展示公开导入；实例创建时按入口类型提供连接、处理器或产物路径。

## 公开入口

| 导入路径                                                | 职责                         | 源码                                                   |
| ------------------------------------------------------- | ---------------------------- | ------------------------------------------------------ |
| `@workbench/runtime-transport-client`                   | 根导出，见源码聚合范围       | [src/index.ts](./src/index.ts)                         |
| `@workbench/runtime-transport-client/runtime-fetch`     | HTTP 地址、认证与 Fetch 载体 | [src/runtime-fetch.ts](./src/runtime-fetch.ts)         |
| `@workbench/runtime-transport-client/runtime-websocket` | WebSocket 地址与认证握手     | [src/runtime-websocket.ts](./src/runtime-websocket.ts) |

## 职责边界

只依赖 runtime-contracts；RuntimeConnection 的安装和保存由 Shell/产品负责。RPC 的 callRpc 在 api/client，具体业务客户端在 services-client 或 pi-rpc-client。本包不创建 Pi 会话、启动进程或实现重连业务策略。

相关能力：[runtime-contracts](../../contracts/runtime-contracts/README.zh-CN.md), [runtime-transport-server](../../transport/runtime-transport-server/README.zh-CN.md), [api](../../transport/api/README.zh-CN.md).

## 源码导航

- [src/runtime-fetch.ts](src/runtime-fetch.ts)
- [src/runtime-websocket.ts](src/runtime-websocket.ts)
- [lib/runtime-url.ts](lib/runtime-url.ts)

## 验证

```bash
pnpm --filter @workbench/runtime-transport-client typecheck
pnpm --filter @workbench/runtime-transport-client test
```

包内测试均为协议、传输、进程或构建逻辑测试；本轮不运行 UI 渲染或交互测试。完整迁移验证见 Spec009。
