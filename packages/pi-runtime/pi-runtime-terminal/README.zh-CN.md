# @workbench/pi-runtime-terminal

[English](README.md) · [包导航](../../README.md) · [本层导航](../README.md)

将 Workbench Terminal 接入 Pi bash ToolDefinition。

执行环境：Node.js / 服务端。

## 职责

- 按 cwd、会话身份和 shell/命令选项创建 Workbench bash 覆盖工具。
- 复用 Terminal 命令策略、PTY 执行、取消与 Agent/用户标准输入处理。

## 如何导入

```ts
import { createWorkbenchBashToolOverride } from "@workbench/pi-runtime-terminal";
```

以上展示公开导入；构造服务或安装能力时，按对应类型声明提供依赖与选项。

### 公开入口与源码

以 [package.json](package.json) 的 `exports` 为准；下表列出当前全部公开子路径。源码链接用于定位实现，跨包代码应使用左侧包入口。

| 导入路径                         | 入口源码                       |
| -------------------------------- | ------------------------------ |
| `@workbench/pi-runtime-terminal` | [src/index.ts](./src/index.ts) |

## 源码导航

| 位置                                             | 说明               |
| ------------------------------------------------ | ------------------ |
| [src/index.ts](src/index.ts)                     | 工具定义与执行适配 |
| [lib/command-options.ts](lib/command-options.ts) | 命令与超时归一化   |

## 边界与接入约定

PTY 进程、原生模块和终端会话归 terminal-server。Host 装配层把此工厂提供给 Pi；保持稳定的 bash 工具名称。

相关所有者：

- [@workbench/terminal-server](../../terminal/terminal-server/README.zh-CN.md)
- [@workbench/terminal-contracts](../../terminal/terminal-contracts/README.zh-CN.md)
- [@workbench/pi-runtime-tools](../pi-runtime-tools/README.zh-CN.md)
- [@workbench/pi-runtime-server](../pi-runtime-server/README.zh-CN.md)

## 维护与验证

```bash
pnpm --filter @workbench/pi-runtime-terminal typecheck
```

实现放在 `src/`，被实现消费的内部辅助放在 `lib/`；保持当前浅层 TypeScript 结构，跨包通过公开入口和 `workspace:*` 引用。非 UI 回归选择与构建策略见[验证记录](../../../docs/package-layout-validation.md)。纯文档修改只需核对入口、路径和格式；本轮不新增或运行 UI/DOM/Hook 测试及交互冒烟。
