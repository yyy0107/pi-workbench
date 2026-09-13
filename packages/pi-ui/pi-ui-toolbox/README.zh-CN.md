# @workbench/pi-ui-toolbox

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Pi 资源管理界面、资源文件接入与 Pi 工具呈现。

执行环境：浏览器 / React。

## 职责

- 通过 Pi 客户端公开 API 管理 Skills、Extensions、Packages 和 Prompts。
- 拥有 Pi 资源后端/文件打开器，以及技能读取和文件变更呈现。

## 如何导入

```ts
import { toolboxExtension, skillReadingExtension } from "@workbench/pi-ui-toolbox";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                         | 入口源码                                 |
| -------------------------------- | ---------------------------------------- |
| `@workbench/pi-ui-toolbox`       | [src/index.ts](./src/index.ts)           |
| `@workbench/pi-ui-toolbox/i18n`  | [src/i18n/index.ts](./src/i18n/index.ts) |
| `@workbench/pi-ui-toolbox/files` | [src/files.ts](./src/files.ts)           |

## 源码导航

| 位置                                                               | 说明                |
| ------------------------------------------------------------------ | ------------------- |
| [src/toolbox-extension.ts](src/toolbox-extension.ts)               | 工具箱贡献          |
| [src/files.ts](src/files.ts)                                       | Pi 资源文件接入     |
| [src/file-runtime-provider.tsx](src/file-runtime-provider.tsx)     | 资源后端 Provider   |
| [lib/file-mutation-tool-model.ts](lib/file-mutation-tool-model.ts) | Pi 文件工具呈现模型 |

## 边界与接入约定

通过产品/扩展安装流程安装导出的 UI 贡献。保持稳定扩展 ID，并随 owner 释放能力订阅与文件打开器。

Shell 拥有通用缓冲、草稿、差异与工作区 Surface。本包提供 Pi 资源后端和 Pi 专属工具元数据；通用 ui-tool 不推断 Pi 协议载荷。

词典与能力共置在 `src/i18n/`，通过公开 `/i18n` 入口注册 `en-US` 和 `zh-CN` bundle。复用共享 UI 与主题 token，保持翻译键、扩展 ID 和释放行为稳定。

相关所有者：

- [@workbench/pi-runtime-client](../../pi-runtime/pi-runtime-client/README.zh-CN.md)
- [@workbench/pi-ui-extensions](../pi-ui-extensions/README.zh-CN.md)
- [@workbench/workspace-files](../../workspace/workspace-files/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-ui-toolbox typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
