# @workbench/pi-sdk-ports

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Pi SDK 服务与工具使用的窄接口：Host、会话访问、流发布和偏好等协作合同。

执行环境：进程内 SDK/Host 合同；根入口仅类型导出。

## 职责

- 定义 Host 绑定、会话访问、流发布、扩展 UI 和工具设置合同。
- 共享领域错误、Trace 采集合同和偏好读取辅助函数。

## 如何导入

```ts
import type { PiAgentHostBindings } from "@workbench/pi-sdk-ports/host";
import type { PiStreamPublisher } from "@workbench/pi-sdk-ports/streams";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

根入口仅导出类型；需要运行时辅助函数时选择对应子路径。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                | 入口源码                                                   |
| --------------------------------------- | ---------------------------------------------------------- |
| `@workbench/pi-sdk-ports`               | [src/index.ts](./src/index.ts)                             |
| `@workbench/pi-sdk-ports/host`          | [src/host-bindings.ts](./src/host-bindings.ts)             |
| `@workbench/pi-sdk-ports/tools`         | [src/tool-settings.ts](./src/tool-settings.ts)             |
| `@workbench/pi-sdk-ports/extension-ui`  | [src/extension-ui.ts](./src/extension-ui.ts)               |
| `@workbench/pi-sdk-ports/sessions`      | [src/session-access.ts](./src/session-access.ts)           |
| `@workbench/pi-sdk-ports/streams`       | [src/stream-publisher.ts](./src/stream-publisher.ts)       |
| `@workbench/pi-sdk-ports/preferences`   | [src/resource-preference.ts](./src/resource-preference.ts) |
| `@workbench/pi-sdk-ports/models`        | [src/model-observation.ts](./src/model-observation.ts)     |
| `@workbench/pi-sdk-ports/errors`        | [src/errors.ts](./src/errors.ts)                           |
| `@workbench/pi-sdk-ports/trace-capture` | [src/trace-capture.ts](./src/trace-capture.ts)             |
| `@workbench/pi-sdk-ports/tool-trace`    | [src/tool-context-trace.ts](./src/tool-context-trace.ts)   |

## 源码导航

| 位置                                                             | 说明           |
| ---------------------------------------------------------------- | -------------- |
| [src/index.ts](src/index.ts)                                     | 仅类型合同聚合 |
| [src/host-bindings.ts](src/host-bindings.ts)                     | Host 注入合同  |
| [src/stream-publisher.ts](src/stream-publisher.ts)               | 流发布合同     |
| [lib/read-builtin-preference.ts](lib/read-builtin-preference.ts) | 共享偏好读取   |

## 边界与接入约定

根入口只导出类型。这些是进程内协作合同，可能含 SDK 类型或回调，不是浏览器线协议 DTO；序列化消息应使用 pi-rpc-contracts。

合同不创建注册表、流、浏览器引擎或另一套资源生命周期。

相关所有者：

- [@workbench/pi-sdk-sessions](../pi-sdk-sessions/README.zh-CN.md)
- [@workbench/pi-sdk-models](../pi-sdk-models/README.zh-CN.md)
- [@workbench/pi-runtime-tools](../../pi-runtime/pi-runtime-tools/README.zh-CN.md)
- [@workbench/browser-contracts](../../contracts/browser-contracts/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-sdk-ports typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
