# @workbench/pi-sdk-models

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Pi 模型与 Provider 服务，以及受保护的 SDK services 创建入口。

执行环境：Node.js / 服务端。

## 职责

- 管理 Provider 配置、模型发现、认证及模型能力探测。
- 按 cwd 创建 SDK services，注入项目信任检查和请求时的 Trace 查询。
- 保持既有受保护 ModelRuntime 与凭据的所有权。

## 如何导入

```ts
import { ModelService } from "@workbench/pi-sdk-models";
import { createWorkbenchAgentSessionServices } from "@workbench/pi-sdk-models/services";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                               | 入口源码                                                         |
| -------------------------------------- | ---------------------------------------------------------------- |
| `@workbench/pi-sdk-models`             | [src/model-service.ts](./src/model-service.ts)                   |
| `@workbench/pi-sdk-models/config`      | [src/model-config-store.ts](./src/model-config-store.ts)         |
| `@workbench/pi-sdk-models/services`    | [src/agent-session-services.ts](./src/agent-session-services.ts) |
| `@workbench/pi-sdk-models/image-probe` | [src/image-probe.ts](./src/image-probe.ts)                       |

## 源码导航

| 位置                                                           | 说明                 |
| -------------------------------------------------------------- | -------------------- |
| [src/model-service.ts](src/model-service.ts)                   | 模型与 Provider 操作 |
| [src/agent-session-services.ts](src/agent-session-services.ts) | SDK services 创建    |
| [src/model-config-store.ts](src/model-config-store.ts)         | 配置持久化           |
| [lib/image-input-probe.ts](lib/image-input-probe.ts)           | 图像输入能力探测     |

## 边界与接入约定

本包不拥有会话注册表、产品内置资源或设置界面。创建 services 时仍需提供公开选项声明的协作依赖。

相关所有者：

- [@workbench/pi-sdk-sessions](../pi-sdk-sessions/README.zh-CN.md)
- [@workbench/pi-runtime-server](../../pi-runtime/pi-runtime-server/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-sdk-models typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
