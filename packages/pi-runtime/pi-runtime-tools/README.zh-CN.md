# @workbench/pi-runtime-tools

[English](README.md)

Pi 内置工具及扩展工厂，通过依赖端口访问宿主与会话。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/legacy-message-termination-extension-source.ts`, `lib/legacy-message-termination.ts`, `lib/system-prompt-hook-trace.ts`, `lib/todo/response-envelope.ts`, `lib/todo/sanitize.ts`, `lib/tool-availability.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/pi-runtime-tools/tool-availability`, `@workbench/pi-runtime-tools/ask-user`, `@workbench/pi-runtime-tools/builtin-tools`, `@workbench/pi-runtime-tools/composer-context`, `@workbench/pi-runtime-tools/context-trace`, `@workbench/pi-runtime-tools/system-prompt-hook-trace`, `@workbench/pi-runtime-tools/dependencies`, `@workbench/pi-runtime-tools/enhanced-search`, `@workbench/pi-runtime-tools`, `@workbench/pi-runtime-tools/message-termination`, `@workbench/pi-runtime-tools/legacy-message-termination-extension-source`, `@workbench/pi-runtime-tools/legacy-message-termination`, `@workbench/pi-runtime-tools/rpiv-todo`, `@workbench/pi-runtime-tools/invariants`, `@workbench/pi-runtime-tools/replay`, `@workbench/pi-runtime-tools/state-reducer`, `@workbench/pi-runtime-tools/state`, `@workbench/pi-runtime-tools/task-graph`, `@workbench/pi-runtime-tools/response-envelope`, `@workbench/pi-runtime-tools/sanitize`, `@workbench/pi-runtime-tools/types`, `@workbench/pi-runtime-tools/workbench-settings`, `@workbench/pi-runtime-tools/workspace-review`, `@workbench/pi-runtime-tools/resources`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/pi-runtime-tools typecheck
pnpm --filter @workbench/pi-runtime-tools test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/legacy-message-termination-extension-source.ts` 引用 `lib/legacy-message-termination-extension-source.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

默认扩展选择与顺序位于 `@workbench/pi-workbench-runtime/extensions`；本包提供独立工具/扩展工厂和运行时结果处理，不导出产品清单。
