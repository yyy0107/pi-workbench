# @workbench/workspace-file-view

[English](README.md)

工作区文件查看与编辑 Surface 及打开器。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/file-breadcrumb-model.ts`, `lib/file-buffer-draft.ts`, `lib/file-view-mode.ts`, `lib/progressive-text-document.ts`, `lib/virtualized-code-window.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/workspace-file-view`, `@workbench/workspace-file-view/opener`, `@workbench/workspace-file-view/openers`, `@workbench/workspace-file-view/surface`, `@workbench/workspace-file-view/i18n`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/workspace-file-view typecheck
pnpm --filter @workbench/workspace-file-view test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/file-breadcrumb-tree.tsx` 引用 `lib/file-breadcrumb-model.ts`。实现保留 TS/TSX；既有构建工具保持原语言。
