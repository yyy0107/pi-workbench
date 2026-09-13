# @workbench/pi-ui-diagnostics

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Pi 上下文 Trace 与用量统计界面。

执行环境：浏览器 / React。

## 职责

- 展示 Trace 概览、详情、搜索、时间线及持久化用量统计。
- 将详情选择/缓存与时间线投影保存在本包辅助模块。

## 如何导入

```ts
import { contextTraceExtension, usageStatisticsExtension } from "@workbench/pi-ui-diagnostics";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                            | 入口源码                                 |
| ----------------------------------- | ---------------------------------------- |
| `@workbench/pi-ui-diagnostics`      | [src/index.ts](./src/index.ts)           |
| `@workbench/pi-ui-diagnostics/i18n` | [src/i18n/index.ts](./src/i18n/index.ts) |

## 源码导航

| 位置                                                                   | 说明               |
| ---------------------------------------------------------------------- | ------------------ |
| [src/index.ts](src/index.ts)                                           | UI 扩展导出        |
| [src/use-context-trace.ts](src/use-context-trace.ts)                   | Trace 订阅生命周期 |
| [lib/context-trace-detail-cache.ts](lib/context-trace-detail-cache.ts) | 详情缓存           |

## 边界与接入约定

通过产品/扩展安装流程安装导出的 UI 贡献。保持稳定扩展 ID，并随 owner 释放能力订阅与文件打开器。

词典与能力共置在 `src/i18n/`，通过公开 `/i18n` 入口注册 `en-US` 和 `zh-CN` bundle。复用共享 UI 与主题 token，保持翻译键、扩展 ID 和释放行为稳定。

相关所有者：

- [@workbench/pi-runtime-client](../../pi-runtime/pi-runtime-client/README.zh-CN.md)
- [@workbench/pi-ui-extensions](../pi-ui-extensions/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-ui-diagnostics typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
