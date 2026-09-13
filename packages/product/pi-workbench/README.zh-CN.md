# @workbench/pi-workbench

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

Web 与 Electron renderer 共用的浏览器/React 产品装配。

执行环境：浏览器 / React。

## 职责

- 组合 Shell Provider、Pi UI bundle、品牌及默认活动指示器。
- 选择最终 UI 贡献顺序并追加平台专属扩展。
- 创建安装实例的传输与共享设置/Host/工作区/自动化客户端。

## 如何导入

```ts
import {
  PiWorkbenchApplicationProviders,
  PiWorkbenchShell,
} from "@workbench/pi-workbench/application";
import { createInstalledAgentRuntime } from "@workbench/pi-workbench/installation";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

本包没有根入口，必须选择下表中的子路径。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                               | 入口源码                                       |
| -------------------------------------- | ---------------------------------------------- |
| `@workbench/pi-workbench/application`  | [src/application.tsx](./src/application.tsx)   |
| `@workbench/pi-workbench/installation` | [src/installation.tsx](./src/installation.tsx) |

## 源码导航

| 位置                                                           | 说明                   |
| -------------------------------------------------------------- | ---------------------- |
| [src/application.tsx](src/application.tsx)                     | 产品 Provider 与 Shell |
| [src/installation.tsx](src/installation.tsx)                   | Runtime 传输与安装     |
| [src/extensions.ts](src/extensions.ts)                         | 最终 UI 扩展顺序       |
| [src/settings.ts](src/settings.ts)                             | 共享设置客户端         |
| [lib/thinking-orb-renderer.tsx](lib/thinking-orb-renderer.tsx) | 活动指示器实现辅助模块 |

## 边界与接入约定

这是前端产品包。Node 内置资源部署和默认 Agent 扩展归 pi-workbench-runtime。

每个安装实例保留自己的 Runtime 连接与客户端实例。UI 组件通过已安装能力复用它们，不另建平行服务客户端。

相关所有者：

- [@workbench/pi-workbench-runtime](../pi-workbench-runtime/README.zh-CN.md)
- [@workbench/pi-ui-extensions](../../pi-ui/pi-ui-extensions/README.zh-CN.md)
- [@workbench/pi-runtime-client](../../pi-runtime/pi-runtime-client/README.zh-CN.md)
- [@workbench/shell](../../client/shell/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-workbench typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
