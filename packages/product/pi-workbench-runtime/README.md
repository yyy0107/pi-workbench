# @workbench/pi-workbench-runtime

Workbench 的 Node 产品配置：定义内置内容、选择默认 Pi 扩展，并部署与升级产品资源。包不依赖 React、前端产品装配或 Runtime Server。

| 位置                                                   | 所有权                             | 公开入口                                             |
| ------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------- |
| [resources/skills](resources/skills)                   | 产品内置 Skills 的唯一源码         | 通过资源安装入口部署                                 |
| [resources/prompts](resources/prompts)                 | 产品内置 Prompt 模板目录           | 通过资源安装入口部署                                 |
| [src/extensions.ts](src/extensions.ts)                 | 内联扩展的选择、隐藏标记与顺序     | `@workbench/pi-workbench-runtime/extensions`         |
| [src/builtin-resources.ts](src/builtin-resources.ts)   | 内置资源部署、旧资源清理与兼容迁移 | `@workbench/pi-workbench-runtime/resources`          |
| [src/builtin-packages.ts](src/builtin-packages.ts)     | 默认 Browser 包注册及旧开关迁移    | `@workbench/pi-workbench-runtime/builtin-packages`   |
| [src/resource-locations.ts](src/resource-locations.ts) | 开发目录与构建资源地址             | `@workbench/pi-workbench-runtime/resource-locations` |

```ts
import { createWorkbenchInternalPiExtensions } from "@workbench/pi-workbench-runtime/extensions";
import { ensureWorkbenchBuiltinResources } from "@workbench/pi-workbench-runtime/resources";
```

工具实现及其依赖注入合同在 `pi-runtime-tools`；本包选择工厂，SDK 在会话加载时执行。顺序维持原样，context-trace 保持最后一个观察者。产品资源沿用 Pi 用户目录的 `.builtin` 路径和既有启停状态，构建产物继续使用 `internal-skills`、`internal-prompts`、`internal-extensions` 和 `internal-packages/browser`。

`resources/prompts` 目前只保留目录占位；后续产品模板放在这里。Browser 的 `browser-use` 技能由可独立安装的 `pi-runtime-browser` 包持有，本产品只负责选择和安装该包。

验证使用非 UI 的资源部署、启停、包升级及扩展顺序测试，记录见 [package-layout-validation.md](../../../docs/package-layout-validation.md)。

`src` 拥有产品策略和公共入口；`lib/builtin-files.ts` 提供实际复用的受保护目录创建、内容比较写入与资源复制辅助函数。
