# @workbench/pi-runtime-adapters

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

共享的 Pi Runtime 身份及确定性数据适配。

执行环境：客户端/服务端共享的数据或合同。

## 职责

- 投影命令、归并流式消息，并解释模型能力与会话展示数据。
- 共享 Composer 提示词适配及既有格式化、分页规则。

## 如何导入

```ts
import { PI_AGENT_RUNTIME_DESCRIPTOR } from "@workbench/pi-runtime-adapters/descriptor";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

本包没有根入口，必须选择下表中的子路径。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                         | 入口源码                                           |
| ------------------------------------------------ | -------------------------------------------------- |
| `@workbench/pi-runtime-adapters/descriptor`      | [src/descriptor.ts](./src/descriptor.ts)           |
| `@workbench/pi-runtime-adapters/commands`        | [src/commands.ts](./src/commands.ts)               |
| `@workbench/pi-runtime-adapters/messages`        | [src/messages.ts](./src/messages.ts)               |
| `@workbench/pi-runtime-adapters/models`          | [src/models.ts](./src/models.ts)                   |
| `@workbench/pi-runtime-adapters/sessions`        | [src/sessions.ts](./src/sessions.ts)               |
| `@workbench/pi-runtime-adapters/composer-prompt` | [src/composer-prompt.ts](./src/composer-prompt.ts) |

## 源码导航

| 位置                                             | 说明                |
| ------------------------------------------------ | ------------------- |
| [src/descriptor.ts](src/descriptor.ts)           | 稳定 Runtime 身份   |
| [src/models.ts](src/models.ts)                   | 模型能力适配        |
| [src/messages.ts](src/messages.ts)               | 消息适配入口        |
| [src/composer-prompt.ts](src/composer-prompt.ts) | Composer 提示词适配 |
| [lib/prompt-template.ts](lib/prompt-template.ts) | 提示词格式辅助函数  |

## 边界与接入约定

本包不拥有连接、凭据或 SDK 会话生命周期。产品资源安装与默认扩展选择位于 pi-workbench-runtime。

相关所有者：

- [@workbench/pi-runtime-client](../pi-runtime-client/README.zh-CN.md)
- [@workbench/pi-sdk-models](../../pi-sdk/pi-sdk-models/README.zh-CN.md)
- [@workbench/pi-conversation-adapter](../pi-conversation-adapter/README.zh-CN.md)
- [@workbench/pi-workbench-runtime](../../product/pi-workbench-runtime/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-runtime-adapters typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
