# @workbench/workspace-runtime

[English](README.md)

工作区 Surface 的无界面控制器、状态、草稿、反馈、持久化与客户端目录选择投影。

`src/` 拥有无界面能力实现、契约与唯一安装实例；`lib/` 只保留旧持久化键辅助源码。React、DOM、呈现、翻译和样式归 `@workbench/ui-workspace`。测试放在 `tests/`。

公开引用入口：`@workbench/workspace-runtime`、`@workbench/workspace-runtime/persistence` 和 `@workbench/workspace-runtime/directory-store`。跨包只使用显式 exports 与 `workspace:*` 依赖，不跨包引用内部源码。

```bash
pnpm --filter @workbench/workspace-runtime typecheck
pnpm --filter @workbench/workspace-runtime test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/right-workspace-persistence.ts` 引用 `lib/legacy-storage.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
