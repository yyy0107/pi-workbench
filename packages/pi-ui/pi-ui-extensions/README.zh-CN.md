# @workbench/pi-ui-extensions

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Pi UI 安装分组、翻译聚合与资源接入。

执行环境：浏览器 / React。

## 职责

- 导出冻结的 agentConfiguration、configuration、toolbox 和 diagnostics 分组。
- 聚合 Pi 翻译 bundle、资源 Provider 接入及活动指示器定义。

## 如何导入

```ts
import {
  piAgentRuntimeExtensionGroups,
  piTranslationBundles,
} from "@workbench/pi-ui-extensions/installation";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

本包没有根入口，必须选择下表中的子路径。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                   | 入口源码                                                     |
| ------------------------------------------ | ------------------------------------------------------------ |
| `@workbench/pi-ui-extensions/installation` | [src/public/installation.tsx](./src/public/installation.tsx) |

## 源码导航

| 位置                                                       | 说明                         |
| ---------------------------------------------------------- | ---------------------------- |
| [src/public/installation.tsx](src/public/installation.tsx) | 公开分组/Provider/bundle API |
| [src/i18n/index.ts](src/i18n/index.ts)                     | Pi 翻译 bundle 聚合          |
| [lib/i18n-runtime.ts](lib/i18n-runtime.ts)                 | 词典注册辅助函数             |

## 边界与接入约定

具体 UI 实现归各 pi-ui-* 包。pi-workbench 将这些分组与 Shell 贡献交错安装，并拥有最终产品激活顺序。

PiAgentRuntimeContributionsProvider 提供 Pi 资源后端；通用文件缓冲和 Surface 归 Shell。外部会话导入是显式按需贡献，不在默认分组中。

这里是 Workbench UI 贡献；由 Agent 执行的 Pi 默认扩展清单归 pi-workbench-runtime。

相关所有者：

- [@workbench/pi-workbench](../../product/pi-workbench/README.zh-CN.md)
- [@workbench/pi-ui-toolbox](../pi-ui-toolbox/README.zh-CN.md)
- [@workbench/pi-ui-status](../pi-ui-status/README.zh-CN.md)
- [@workbench/pi-ui-session-import](../pi-ui-session-import/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-ui-extensions typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
