# @workbench/pi-workbench-runtime

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Node 产品默认配置：内置资源、Pi 扩展选择与部署策略。

执行环境：Node.js / 服务端。

## 职责

- 拥有产品 Skills 与 Prompt 模板目录，以及开发/产物资源地址。
- 选择默认内联扩展工厂、隐藏标记与安装顺序，保持 Trace 最后安装。
- 部署内置资源、注册 Browser 包，并迁移旧路径与启停状态。

## 如何导入

```ts
import { createWorkbenchInternalPiExtensions } from "@workbench/pi-workbench-runtime/extensions";
import { ensureWorkbenchBuiltinResources } from "@workbench/pi-workbench-runtime/resources";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

本包没有根入口，必须选择下表中的子路径。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                             | 入口源码                                                 |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `@workbench/pi-workbench-runtime/resources`          | [src/builtin-resources.ts](./src/builtin-resources.ts)   |
| `@workbench/pi-workbench-runtime/resource-locations` | [src/resource-locations.ts](./src/resource-locations.ts) |
| `@workbench/pi-workbench-runtime/extensions`         | [src/extensions.ts](./src/extensions.ts)                 |
| `@workbench/pi-workbench-runtime/builtin-packages`   | [src/builtin-packages.ts](./src/builtin-packages.ts)     |

## 源码导航

| 位置                                                 | 说明                               |
| ---------------------------------------------------- | ---------------------------------- |
| [resources/skills](resources/skills)                 | 产品 Skills                        |
| [resources/prompts](resources/prompts)               | 产品 Prompt 模板（当前为占位目录） |
| [src/extensions.ts](src/extensions.ts)               | 默认 Agent 扩展清单                |
| [src/builtin-resources.ts](src/builtin-resources.ts) | 部署与退役资源清理                 |
| [src/builtin-packages.ts](src/builtin-packages.ts)   | 默认包注册与迁移                   |
| [lib/builtin-files.ts](lib/builtin-files.ts)         | 受保护的资源文件操作               |

## 边界与接入约定

本包独立于 React、前端产品装配和 pi-runtime-server。服务端装配层选择本包，并向工具工厂提供 Host 协作依赖。

工具实现位于 pi-runtime-tools。Browser 为独立分发而拥有配套 browser-use 技能；本产品拥有默认安装选择。

部署保留 .builtin 路径及 internal-skills/internal-prompts/internal-extensions/internal-packages/browser 产物位置。保持既有工具 ID、资源开关与迁移行为。

相关所有者：

- [@workbench/pi-workbench](../pi-workbench/README.zh-CN.md)
- [@workbench/pi-runtime-tools](../../pi-runtime/pi-runtime-tools/README.zh-CN.md)
- [@workbench/pi-runtime-browser](../../pi-runtime/pi-runtime-browser/README.zh-CN.md)
- [@workbench/pi-sdk-resources](../../pi-sdk/pi-sdk-resources/README.zh-CN.md)
- [@workbench/pi-runtime-server](../../pi-runtime/pi-runtime-server/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-workbench-runtime typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
