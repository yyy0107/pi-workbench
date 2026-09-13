# @workbench/workspace-runtime

[English](README.md)

工作区 Surface 控制器、持久化、标签与 React Host。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/legacy-storage.ts`, `lib/surface-mount-policy.ts`, `lib/workspace-split-layout.ts`, `lib/workspace-tab-a11y.ts`, `lib/workspace-tab-layout.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/workspace-runtime`, `@workbench/workspace-runtime/react`, `@workbench/workspace-runtime/presentation`, `@workbench/workspace-runtime/persistence`, `@workbench/workspace-runtime/directory-store`, `@workbench/workspace-runtime/i18n`, `@workbench/workspace-runtime/styles.css`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/workspace-runtime typecheck
pnpm --filter @workbench/workspace-runtime test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/right-workspace-persistence.ts` 引用 `lib/legacy-storage.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
