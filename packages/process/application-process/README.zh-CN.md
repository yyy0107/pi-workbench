# @workbench/application-process

[English](README.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

Workbench Runtime 与 Web 服务进程的生命周期能力。负责仅 API 的 Runtime 启动、标准输入/输出控制会话、子进程启动和退出、服务就绪探测以及 Windows 进程树处理。运行在 Node 或 Electron 主进程使用的 Node 环境。

## 如何导入

```ts
import { startRuntimeSidecar } from "@workbench/application-process/runtime-sidecar-child";
import { runRuntimeHostControlSession } from "@workbench/application-process/runtime-host-control-session";
import { startApiOnlyRuntimeHost } from "@workbench/application-process/api-only-runtime-host";
```

以上仅展示公开导入；实例创建时按入口类型提供连接、处理器或产物路径。

本包没有根入口，必须使用下表中的子路径。

## 公开入口

| 导入路径                                                      | 职责                                | 源码                                                                         |
| ------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `@workbench/application-process/api-only-runtime-host`        | API Runtime 服务启动与关闭          | [src/api-only-runtime-host.ts](./src/api-only-runtime-host.ts)               |
| `@workbench/application-process/runtime-host-control-session` | Runtime 控制会话与清理              | [src/runtime-host-control-session.ts](./src/runtime-host-control-session.ts) |
| `@workbench/application-process/web-host-control-session`     | Web 控制会话与清理                  | [src/web-host-control-session.ts](./src/web-host-control-session.ts)         |
| `@workbench/application-process/runtime-sidecar-child`        | Runtime 子进程启动、流式脱敏与退出  | [src/runtime-sidecar-child.ts](./src/runtime-sidecar-child.ts)               |
| `@workbench/application-process/windows-process-census`       | Windows 进程身份与进程树清理（CJS） | [src/windows-process-census.cjs](./src/windows-process-census.cjs)           |
| `@workbench/application-process/host-probe`                   | 服务身份和就绪探测（CJS）           | [src/host-probe.cjs](./src/host-probe.cjs)                                   |

## 职责边界

依赖 runtime-contracts 和 runtime-transport-server。应用负责选择可执行文件、解析和准入产物、组装 Pi/终端/浏览器等业务图，再注入启动与清理接口。进程控制保持既有超时、取消、认证和清理语义。extension-host 管理扩展与 UI 挂载，是独立职责。

相关能力：[runtime-transport-server](../../transport/runtime-transport-server/README.zh-CN.md), [artifact-reader](../../build/artifact-reader/README.zh-CN.md), [extension-host](../../extension-platform/extension-host/README.zh-CN.md).

## 源码导航

- [src/runtime-sidecar-child.ts](src/runtime-sidecar-child.ts)
- [src/runtime-host-control-session.ts](src/runtime-host-control-session.ts)
- [src/web-host-control-session.ts](src/web-host-control-session.ts)
- [src/api-only-runtime-host.ts](src/api-only-runtime-host.ts)
- [src/host-probe.cjs](src/host-probe.cjs)
- [src/windows-process-census.cjs](src/windows-process-census.cjs)
- [lib/streaming-secret-redactor.ts](lib/streaming-secret-redactor.ts)

## 验证

```bash
pnpm --filter @workbench/application-process typecheck
pnpm --filter @workbench/application-process test
```

包内测试均为协议、传输、进程或构建逻辑测试；本轮不运行 UI 渲染或交互测试。完整迁移验证见 Spec009。
