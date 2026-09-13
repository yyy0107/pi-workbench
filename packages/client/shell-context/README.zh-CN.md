# @workbench/shell-context

[English](README.md)

安装级 DOM、导航、布局、展示与 Runtime 连接 Context。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/layout/thread-content-width.ts`, `lib/workbench-shell-owner.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/shell-context`, `@workbench/shell-context/dom`, `@workbench/shell-context/navigation`, `@workbench/shell-context/presentation`, `@workbench/shell-context/runtime-connection`, `@workbench/shell-context/layout`, `@workbench/shell-context/layout-motion`, `@workbench/shell-context/running-indicator`, `@workbench/shell-context/panel-store`, `@workbench/shell-context/navigation-policy`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/shell-context typecheck
pnpm --filter @workbench/shell-context test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/layout.tsx` 引用 `lib/layout/thread-content-width.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
