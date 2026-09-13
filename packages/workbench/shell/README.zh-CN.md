# @workbench/shell

[English](README.md)

Workbench 布局、侧栏与应用 Shell 装配；通过公开包入口消费能力。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/thread-sort.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/shell/application`, `@workbench/shell/browser-session-persistence`, `@workbench/shell/extensions`, `@workbench/shell/hosts/statusbar`, `@workbench/shell/i18n`, `@workbench/shell/i18n/runtime`, `@workbench/shell/panels`, `@workbench/shell/styles.css`, `@workbench/shell/workbench`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/shell typecheck
pnpm --filter @workbench/shell test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/sidebar/workspace-sidebar-context.tsx` 引用 `lib/thread-sort.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
