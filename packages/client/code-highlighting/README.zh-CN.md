# @workbench/code-highlighting

[English](README.md)

代码高亮、编辑器、Diff 与代码表面。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/code-highlight-policy.ts`, `lib/diff/range.ts`, `lib/diff/unified-patch.ts`, `lib/shiki-token-style.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/code-highlighting`, `@workbench/code-highlighting/engine`, `@workbench/code-highlighting/header`, `@workbench/code-highlighting/i18n`, `@workbench/code-highlighting/styles.css`, `@workbench/code-highlighting/editor.css`, `@workbench/code-highlighting/diff.css`, `@workbench/code-highlighting/code-block.css`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/code-highlighting typecheck
pnpm --filter @workbench/code-highlighting test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/index.ts` 引用 `lib/code-highlight-policy.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

代码标题栏控件尺寸与标题栏共置于 code-block.css；工具协议适配不属于本渲染能力。
