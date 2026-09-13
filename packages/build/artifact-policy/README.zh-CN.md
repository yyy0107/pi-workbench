# @workbench/artifact-policy

[English](README.md) · [Packages](../../README.md) · [Spec009](../../../specs/009-host-infrastructure-naming/plan.md)

Workbench 构建与启动采用的产物准入规则：源码形态、Runtime 原生依赖、模型可读取资源和 Next standalone 依赖补齐规则。供 Runtime、Web、Desktop 构建器及启动校验共用。

## 如何导入

```js
const {
  createRuntimeArtifactAdmissionPolicy,
} = require("@workbench/artifact-policy/runtime-admission");
const { isInside } = require("@workbench/artifact-policy/filesystem");
```

以上仅展示公开导入；实例创建时按入口类型提供连接、处理器或产物路径。

本包没有根入口，必须使用下表中的子路径。

## 公开入口

| 导入路径                                                | 职责                           | 源码                                                                       |
| ------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `@workbench/artifact-policy/source-shape`               | 构建产物源码/测试形态规则      | [src/source-shape.cjs](./src/source-shape.cjs)                             |
| `@workbench/artifact-policy/runtime-native`             | Runtime 原生依赖清单与目标规则 | [src/runtime-native.cjs](./src/runtime-native.cjs)                         |
| `@workbench/artifact-policy/runtime-model-resources`    | 模型可读取资源范围规则         | [src/runtime-model-resources.cjs](./src/runtime-model-resources.cjs)       |
| `@workbench/artifact-policy/runtime-admission`          | 组装 Runtime 产物准入策略      | [src/runtime-admission.cjs](./src/runtime-admission.cjs)                   |
| `@workbench/artifact-policy/web-next-runtime-exception` | Next standalone 运行依赖例外   | [src/web-next-runtime-exception.cjs](./src/web-next-runtime-exception.cjs) |
| `@workbench/artifact-policy/filesystem`                 | 构建器共享的文件和路径辅助     | [src/filesystem.cjs](./src/filesystem.cjs)                                 |

## 职责边界

这是既有 CommonJS 构建工具包，保留 CJS 公开入口。部分入口读取 TypeScript 工作区合同，调用环境需沿用项目的 tsx/cjs 注册方式。应用选择具体 Agent 协议路径并提供给 runtime-admission；artifact-reader 执行读取校验，application-process 负责进程生命周期。这里不存放内置 skills 或 Pi 扩展清单。

相关能力：[artifact-reader](../../build/artifact-reader/README.zh-CN.md), [runtime-contracts](../../contracts/runtime-contracts/README.zh-CN.md), [pi-workbench-runtime](../../product/pi-workbench-runtime/README.zh-CN.md).

## 源码导航

- [src/runtime-admission.cjs](src/runtime-admission.cjs)
- [src/runtime-native.cjs](src/runtime-native.cjs)
- [src/runtime-model-resources.cjs](src/runtime-model-resources.cjs)
- [src/source-shape.cjs](src/source-shape.cjs)
- [src/web-next-runtime-exception.cjs](src/web-next-runtime-exception.cjs)
- [lib/filesystem.cjs](lib/filesystem.cjs)

## 验证

```bash
pnpm --filter @workbench/artifact-policy test
```

包内测试均为协议、传输、进程或构建逻辑测试；本轮不运行 UI 渲染或交互测试。完整迁移验证见 Spec009。
