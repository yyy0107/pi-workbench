# @workbench/markdown

[English](README.md)

Markdown、公式、Mermaid、预览和可注入的文件链接。

`src/` 拥有能力实现、契约与装配；`lib/` 为内部辅助源码，包含 `lib/inline-citation-markers.ts`, `lib/markdown-normalize.ts`。测试放在 `tests/`。能力和辅助源码保留 TS/TSX，既有构建工具维持原语言；两处源码目录均最多一级子目录。

公开引用入口：`@workbench/markdown`, `@workbench/markdown/render`, `@workbench/markdown/links`, `@workbench/markdown/website-icon`, `@workbench/markdown/i18n`, `@workbench/markdown/styles.css`。跨包只使用显式 exports 与 `workspace:*` 依赖；不跨包引用内部源码。

```bash
pnpm --filter @workbench/markdown typecheck
pnpm --filter @workbench/markdown test
```

源码分工：src 承载本包能力与契约，lib 仅放实际使用的内部辅助，tests 为包根测试。实际消费者示例：`src/markdown-text.tsx` 引用 `lib/inline-citation-markers.ts`。实现保留 TS/TSX；既有构建工具保持原语言。

Markdown 预览控件与会话字体继承样式由本包提供，不再由消息列表样式定义。
