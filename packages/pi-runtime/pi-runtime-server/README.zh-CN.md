# @workbench/pi-runtime-server

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Node 侧的 Pi SDK 服务装配与 Workbench Runtime 传输接线。

执行环境：Node.js / 服务端。

## 职责

- 将 SDK 会话、模型和资源服务绑定到 Workbench Host 协作对象及 Agent 服务端端口。
- 拥有有序 RPC 路由装配、HTTP handler、流发布及 no-server WebSocket gateway。
- 选择 Node 产品资源和默认扩展，将既有协作依赖注入 SDK 服务。

## 如何导入

```ts
import { createPiAgentServerImplementation } from "@workbench/pi-runtime-server/installation";
import { createPiRuntimeHttpRouter } from "@workbench/pi-runtime-server/http";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

本包没有根入口，必须选择下表中的子路径。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                    | 入口源码                                                   |
| ------------------------------------------- | ---------------------------------------------------------- |
| `@workbench/pi-runtime-server/installation` | [src/public/installation.ts](./src/public/installation.ts) |
| `@workbench/pi-runtime-server/http`         | [src/public/http.ts](./src/public/http.ts)                 |
| `@workbench/pi-runtime-server/websocket`    | [src/public/websocket.ts](./src/public/websocket.ts)       |
| `@workbench/pi-runtime-server/legacy`       | [src/public/legacy.ts](./src/public/legacy.ts)             |

## 源码导航

| 位置                                                                             | 说明                 |
| -------------------------------------------------------------------------------- | -------------------- |
| [src/public/installation.ts](src/public/installation.ts)                         | 面向应用的安装合同   |
| [src/resource-composition.ts](src/resource-composition.ts)                       | 资源服务装配         |
| [src/session-composition/registry.ts](src/session-composition/registry.ts)       | 注册表选择与绑定     |
| [src/tool-composition.ts](src/tool-composition.ts)                               | 产品工厂与 Host 依赖 |
| [src/transport/rpc-route-composition.ts](src/transport/rpc-route-composition.ts) | RPC 路由装配         |
| [lib/compaction-rpc-validator.ts](lib/compaction-rpc-validator.ts)               | 压缩请求校验         |

## 边界与接入约定

会话、模型和资源服务的实际实现归 SDK 包。本包负责装配；Runtime 应用拥有外层 Host 入口、信任/认证和进程启动。

legacy 入口支持既有兼容路由；新消费者应按职责选择 installation、http 或 websocket。

相关所有者：

- [@workbench/pi-sdk-sessions](../../pi-sdk/pi-sdk-sessions/README.zh-CN.md)
- [@workbench/pi-sdk-resources](../../pi-sdk/pi-sdk-resources/README.zh-CN.md)
- [@workbench/pi-sdk-models](../../pi-sdk/pi-sdk-models/README.zh-CN.md)
- [@workbench/pi-workbench-runtime](../../product/pi-workbench-runtime/README.zh-CN.md)
- [@workbench/agent-runtime-server](../../agent-runtime/agent-runtime-server/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-runtime-server typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
