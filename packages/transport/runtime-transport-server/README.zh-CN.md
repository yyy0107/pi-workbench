# @workbench/runtime-transport-server

[English](README.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

Node 端 Runtime HTTP / WebSocket 传输入口：提供 HTTP server、Fetch/Node 请求适配、连接认证及到 Runtime 子进程的代理。业务处理器和 WebSocket gateway 由应用注入。

## 如何导入

```ts
import { createWorkbenchHttpServer } from "@workbench/runtime-transport-server/workbench-http-server";
import { createFetchRequestHandler } from "@workbench/runtime-transport-server/fetch-request-handler";
import { createRuntimeSidecarProxy } from "@workbench/runtime-transport-server/runtime-sidecar-proxy";
```

以上仅展示公开导入；实例创建时按入口类型提供连接、处理器或产物路径。

本包没有根入口，必须使用下表中的子路径。

## 公开入口

| 导入路径                                                     | 职责                                     | 源码                                                             |
| ------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------- |
| `@workbench/runtime-transport-server/runtime-transport-auth` | 连接认证、Origin 与载体限制              | [src/runtime-transport-auth.ts](./src/runtime-transport-auth.ts) |
| `@workbench/runtime-transport-server/workbench-http-server`  | HTTP server 与 WebSocket upgrade 分发    | [src/workbench-http-server.ts](./src/workbench-http-server.ts)   |
| `@workbench/runtime-transport-server/fetch-request-handler`  | Node HTTP 与 Fetch Request/Response 适配 | [src/fetch-request-handler.ts](./src/fetch-request-handler.ts)   |
| `@workbench/runtime-transport-server/runtime-sidecar-proxy`  | HTTP / WebSocket 到 Runtime 的代理       | [src/runtime-sidecar-proxy.ts](./src/runtime-sidecar-proxy.ts)   |

## 职责边界

本包只依赖 runtime-contracts 与 server-core，不拥有 Runtime 子进程、Pi 服务图或产物读取。认证在业务 gateway 分配连接前完成。代理负责连接转发与关闭；子进程启动、ready/shutdown 控制会话由 application-process 负责。通用 RPC 分发使用 api/server。

相关能力：[runtime-transport-client](../../transport/runtime-transport-client/README.zh-CN.md), [application-process](../../process/application-process/README.zh-CN.md), [runtime-contracts](../../contracts/runtime-contracts/README.zh-CN.md).

## 源码导航

- [src/workbench-http-server.ts](src/workbench-http-server.ts)
- [src/fetch-request-handler.ts](src/fetch-request-handler.ts)
- [src/runtime-sidecar-proxy.ts](src/runtime-sidecar-proxy.ts)
- [lib/runtime-transport-auth.ts](lib/runtime-transport-auth.ts)

## 验证

```bash
pnpm --filter @workbench/runtime-transport-server typecheck
pnpm --filter @workbench/runtime-transport-server test
```

包内测试均为协议、传输、进程或构建逻辑测试；本轮不运行 UI 渲染或交互测试。完整迁移验证见 Spec009。
