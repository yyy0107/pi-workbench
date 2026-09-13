# @workbench/pi-tools

[English](README.md)

Pi 内置工具及扩展工厂，通过依赖端口访问宿主与会话。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/legacy-message-termination-extension-source.ts`, `lib/legacy-message-termination.ts`, `lib/system-prompt-hook-trace.ts`, `lib/todo/response-envelope.ts`, `lib/todo/sanitize.ts`, `lib/tool-availability.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/pi-tools/tool-availability`, `@workbench/pi-tools/ask-user`, `@workbench/pi-tools/builtin-tools`, `@workbench/pi-tools/composer-context`, `@workbench/pi-tools/context-trace`, `@workbench/pi-tools/system-prompt-hook-trace`, `@workbench/pi-tools/dependencies`, `@workbench/pi-tools/enhanced-search`, `@workbench/pi-tools`, `@workbench/pi-tools/message-termination`, `@workbench/pi-tools/legacy-message-termination-extension-source`, `@workbench/pi-tools/legacy-message-termination`, `@workbench/pi-tools/rpiv-todo`, `@workbench/pi-tools/invariants`, `@workbench/pi-tools/replay`, `@workbench/pi-tools/state-reducer`, `@workbench/pi-tools/state`, `@workbench/pi-tools/task-graph`, `@workbench/pi-tools/response-envelope`, `@workbench/pi-tools/sanitize`, `@workbench/pi-tools/types`, `@workbench/pi-tools/workbench-settings`, `@workbench/pi-tools/workspace-review`, `@workbench/pi-tools/resources`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/pi-tools typecheck
pnpm --filter @workbench/pi-tools test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/legacy-message-termination-extension-source.ts` 引用 `lib/legacy-message-termination-extension-source.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
