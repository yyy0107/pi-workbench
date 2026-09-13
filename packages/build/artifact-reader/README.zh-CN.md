# @workbench/artifact-reader

[English](README.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

在 Node 中读取并验证 Runtime / Web 构建产物。核对 manifest、文件清单、哈希、路径约束、目标运行环境与启动入口，供构建器、启动器和发布校验复用。

## 如何导入

```ts
import { resolveRuntimeArtifact } from "@workbench/artifact-reader/runtime-artifact";
import { resolveWebArtifact } from "@workbench/artifact-reader/web-artifact";
```

以上仅展示公开导入；实例创建时按入口类型提供连接、处理器或产物路径。

本包没有根入口，必须使用下表中的子路径。

## 公开入口

| 导入路径                                      | 职责                               | 源码                                                 |
| --------------------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| `@workbench/artifact-reader/web-artifact`     | Web 产物读取与完整性校验           | [src/web-artifact.ts](./src/web-artifact.ts)         |
| `@workbench/artifact-reader/runtime-artifact` | Runtime 产物读取、目标及完整性校验 | [src/runtime-artifact.ts](./src/runtime-artifact.ts) |

## 职责边界

唯一生产依赖为 runtime-contracts。这里负责产物读取和完整性校验，不启动服务器或子进程，也不选择产品原生依赖与资源清单。Runtime 原生依赖及资源准入规则由应用从 artifact-policy 取得并注入。Web 读取保持同步，Runtime 读取保持异步。

相关能力：[runtime-contracts](../../contracts/runtime-contracts/README.zh-CN.md), [artifact-policy](../../build/artifact-policy/README.zh-CN.md), [application-process](../../process/application-process/README.zh-CN.md).

## 源码导航

- [src/runtime-artifact.ts](src/runtime-artifact.ts)
- [src/web-artifact.ts](src/web-artifact.ts)
- [lib/artifact-path.ts](lib/artifact-path.ts)

## 验证

```bash
pnpm --filter @workbench/artifact-reader typecheck
pnpm --filter @workbench/artifact-reader test
```

包内测试均为协议、传输、进程或构建逻辑测试；本轮不运行 UI 渲染或交互测试。完整迁移验证见 Spec009。
