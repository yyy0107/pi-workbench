# @workbench/runtime-contracts

[English](README.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

共享 Runtime 连接、宿主能力、进程控制和构建产物格式合同。浏览器、Node 服务及构建器使用同一份协议定义；本包没有生产依赖。

## 如何导入

```ts
import { defineRuntimeConnection } from "@workbench/runtime-contracts/runtime-connection";
import { parseRuntimeHostIdentity } from "@workbench/runtime-contracts/runtime-host-identity";
```

以上仅展示公开导入；实例创建时按入口类型提供连接、处理器或产物路径。

## 公开入口

| 导入路径                                                          | 职责                                 | 源码                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `@workbench/runtime-contracts`                                    | 根导出，见源码聚合范围               | [src/index.ts](./src/index.ts)                                                           |
| `@workbench/runtime-contracts/runtime-connection`                 | 连接描述与认证帧                     | [src/runtime-connection.ts](./src/runtime-connection.ts)                                 |
| `@workbench/runtime-contracts/runtime-capabilities`               | 宿主文件、目录、应用、信任等能力 DTO | [src/runtime-capabilities.ts](./src/runtime-capabilities.ts)                             |
| `@workbench/runtime-contracts/host-control`                       | 基础宿主 ready/shutdown 消息         | [src/host-control.ts](./src/host-control.ts)                                             |
| `@workbench/runtime-contracts/runtime-connected-web-control`      | Web 与 Runtime 的连接运行模式        | [src/runtime-connected-web-control.ts](./src/runtime-connected-web-control.ts)           |
| `@workbench/runtime-contracts/control-ndjson`                     | 有界控制消息编解码                   | [src/control-ndjson.ts](./src/control-ndjson.ts)                                         |
| `@workbench/runtime-contracts/runtime-host-control`               | Runtime 进程控制协议                 | [src/runtime-host-control.ts](./src/runtime-host-control.ts)                             |
| `@workbench/runtime-contracts/runtime-host-identity`              | Runtime 身份协议与解析               | [src/runtime-host-identity.ts](./src/runtime-host-identity.ts)                           |
| `@workbench/runtime-contracts/runtime-artifact-manifest`          | Runtime 产物格式与校验               | [src/runtime-artifact-manifest.ts](./src/runtime-artifact-manifest.ts)                   |
| `@workbench/runtime-contracts/web-host-control`                   | Web 进程控制协议                     | [src/web-host-control.ts](./src/web-host-control.ts)                                     |
| `@workbench/runtime-contracts/web-artifact-manifest`              | Web 产物格式与校验                   | [src/web-artifact-manifest.ts](./src/web-artifact-manifest.ts)                           |
| `@workbench/runtime-contracts/desktop-renderer-artifact-manifest` | Desktop Renderer 产物格式与校验      | [src/desktop-renderer-artifact-manifest.ts](./src/desktop-renderer-artifact-manifest.ts) |

## 职责边界

这里的 Runtime 指 Workbench 后台及其运行协议。Agent 会话合同归 agent-runtime-contracts，Pi 协议归 pi-rpc-contracts，通用 RPC 信封归 api/contracts。产物格式通过专用子路径读取；根入口只聚合连接、宿主能力及基础控制定义。

相关能力：[runtime-transport-client](../../transport/runtime-transport-client/README.zh-CN.md), [application-process](../../process/application-process/README.zh-CN.md), [artifact-reader](../../build/artifact-reader/README.zh-CN.md).

## 源码导航

- [src/runtime-connection.ts](src/runtime-connection.ts)
- [src/runtime-capabilities.ts](src/runtime-capabilities.ts)
- [src/runtime-host-control.ts](src/runtime-host-control.ts)
- [src/runtime-artifact-manifest.ts](src/runtime-artifact-manifest.ts)
- [lib/control-ndjson.ts](lib/control-ndjson.ts)

## 验证

```bash
pnpm --filter @workbench/runtime-contracts typecheck
pnpm --filter @workbench/runtime-contracts test
```

包内测试均为协议、传输、进程或构建逻辑测试；本轮不运行 UI 渲染或交互测试。完整迁移验证见 Spec009。
