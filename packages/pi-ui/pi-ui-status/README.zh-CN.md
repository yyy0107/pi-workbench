# @workbench/pi-ui-status

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Pi 关于页、版本/连接状态与活动指示器。

执行环境：浏览器 / React。

## 职责

- 提供关于页与连接状态贡献。
- 提供活动指示器定义与渲染器，保留持久化样式 ID。

## 如何导入

```ts
import { aboutExtension, connectionStatusExtension } from "@workbench/pi-ui-status";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                                    | 入口源码                                                       |
| ------------------------------------------- | -------------------------------------------------------------- |
| `@workbench/pi-ui-status`                   | [src/index.ts](./src/index.ts)                                 |
| `@workbench/pi-ui-status/i18n`              | [src/i18n/index.ts](./src/i18n/index.ts)                       |
| `@workbench/pi-ui-status/running-indicator` | [src/pi-running-indicator.tsx](./src/pi-running-indicator.tsx) |

## 源码导航

| 位置                                                         | 说明                 |
| ------------------------------------------------------------ | -------------------- |
| [src/index.ts](src/index.ts)                                 | 状态扩展导出         |
| [src/pi-running-indicator.tsx](src/pi-running-indicator.tsx) | 活动指示器 API       |
| [lib/wordmark-pixels.ts](lib/wordmark-pixels.ts)             | 共享文字标志几何数据 |

## 边界与接入约定

通过产品/扩展安装流程安装导出的 UI 贡献。保持稳定扩展 ID，并随 owner 释放能力订阅与文件打开器。

词典与能力共置在 `src/i18n/`，通过公开 `/i18n` 入口注册 `en-US` 和 `zh-CN` bundle。复用共享 UI 与主题 token，保持翻译键、扩展 ID 和释放行为稳定。

相关所有者：

- [@workbench/pi-ui-extensions](../pi-ui-extensions/README.zh-CN.md)
- [@workbench/pi-workbench](../../product/pi-workbench/README.zh-CN.md)
- [@workbench/pi-runtime-client](../../pi-runtime/pi-runtime-client/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-ui-status typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
