# @workbench/pi-sdk-resources

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Pi 资源加载、目录查询、变更与重载协调服务。

执行环境：Node.js / 服务端。

## 职责

- 通过明确入口提供 Skills、Extensions、Packages、Prompts 和 Commands 服务。
- 拥有资源启停、文本文件访问、项目信任、设置及变更/重载协调。
- 适配工作区协议操作，并复用 workspace-server 的目录存储。

## 如何导入

```ts
import {
  SkillService,
  ExtensionService,
  InstalledPackageService,
} from "@workbench/pi-sdk-resources";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                                    | 入口源码                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `@workbench/pi-sdk-resources`                               | [src/index.ts](./src/index.ts)                                                       |
| `@workbench/pi-sdk-resources/internal-extensions`           | [src/internal-extensions.ts](./src/internal-extensions.ts)                           |
| `@workbench/pi-sdk-resources/mutations`                     | [src/pi-resource-mutation-coordinator.ts](./src/pi-resource-mutation-coordinator.ts) |
| `@workbench/pi-sdk-resources/resource-mutations`            | [src/resource-mutations.ts](./src/resource-mutations.ts)                             |
| `@workbench/pi-sdk-resources/resource-text-file`            | [src/resource-text-file.ts](./src/resource-text-file.ts)                             |
| `@workbench/pi-sdk-resources/contexts`                      | [src/scoped-resource-context.ts](./src/scoped-resource-context.ts)                   |
| `@workbench/pi-sdk-resources/builtin-skills`                | [src/builtin-skills.ts](./src/builtin-skills.ts)                                     |
| `@workbench/pi-sdk-resources/skill-enablement`              | [src/skill-enablement.ts](./src/skill-enablement.ts)                                 |
| `@workbench/pi-sdk-resources/skills`                        | [src/skill-service.ts](./src/skill-service.ts)                                       |
| `@workbench/pi-sdk-resources/extension-name`                | [src/extension-name.ts](./src/extension-name.ts)                                     |
| `@workbench/pi-sdk-resources/extensions`                    | [src/extension-service.ts](./src/extension-service.ts)                               |
| `@workbench/pi-sdk-resources/packages`                      | [src/installed-package-service.ts](./src/installed-package-service.ts)               |
| `@workbench/pi-sdk-resources/catalog`                       | [src/package-catalog-service.ts](./src/package-catalog-service.ts)                   |
| `@workbench/pi-sdk-resources/package-resource-details`      | [src/package-resource-details.ts](./src/package-resource-details.ts)                 |
| `@workbench/pi-sdk-resources/package-update-metadata`       | [src/package-update-metadata.ts](./src/package-update-metadata.ts)                   |
| `@workbench/pi-sdk-resources/commands`                      | [src/command-service.ts](./src/command-service.ts)                                   |
| `@workbench/pi-sdk-resources/composer-command-failure`      | [src/composer-command-failure.ts](./src/composer-command-failure.ts)                 |
| `@workbench/pi-sdk-resources/composer-command-planner`      | [src/composer-command-planner.ts](./src/composer-command-planner.ts)                 |
| `@workbench/pi-sdk-resources/pi-composer-command-arguments` | [src/pi-composer-command-arguments.ts](./src/pi-composer-command-arguments.ts)       |
| `@workbench/pi-sdk-resources/pi-composer-command-catalog`   | [src/pi-composer-command-catalog.ts](./src/pi-composer-command-catalog.ts)           |
| `@workbench/pi-sdk-resources/prompt-template-expander`      | [src/prompt-template-expander.ts](./src/prompt-template-expander.ts)                 |
| `@workbench/pi-sdk-resources/prompts`                       | [src/prompt-service.ts](./src/prompt-service.ts)                                     |
| `@workbench/pi-sdk-resources/settings`                      | [src/agent-settings-service.ts](./src/agent-settings-service.ts)                     |
| `@workbench/pi-sdk-resources/trust`                         | [src/project-trust-service.ts](./src/project-trust-service.ts)                       |
| `@workbench/pi-sdk-resources/workspace-paths`               | [src/workspace-paths.ts](./src/workspace-paths.ts)                                   |
| `@workbench/pi-sdk-resources/workspaces`                    | [src/workspace-protocol-service.ts](./src/workspace-protocol-service.ts)             |

## 源码导航

| 位置                                                                               | 说明               |
| ---------------------------------------------------------------------------------- | ------------------ |
| [src/skill-service.ts](src/skill-service.ts)                                       | Skill 服务         |
| [src/extension-service.ts](src/extension-service.ts)                               | Extension 服务     |
| [src/installed-package-service.ts](src/installed-package-service.ts)               | 已安装包服务       |
| [src/pi-resource-mutation-coordinator.ts](src/pi-resource-mutation-coordinator.ts) | 变更与重载协调     |
| [lib/resource-mutations.ts](lib/resource-mutations.ts)                             | 路径与启停辅助函数 |

## 边界与接入约定

产品 Skills/Prompts、默认扩展选择和部署归 pi-workbench-runtime。builtin-skills 入口加载已安装资源；builtin-packages 识别受保护的已安装来源；这两个入口都不携带产品资源文件。

服务端装配层注入会话访问、资源上下文、工具与发布器。资源服务不另建协调器，也不导入整个服务端注册表。

相关所有者：

- [@workbench/pi-workbench-runtime](../../product/pi-workbench-runtime/README.zh-CN.md)
- [@workbench/pi-runtime-server](../../pi-runtime/pi-runtime-server/README.zh-CN.md)
- [@workbench/workspace-server](../../server/workspace-server/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-sdk-resources typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
