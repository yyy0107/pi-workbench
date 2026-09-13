# 代码高亮

拥有 Shiki 注册与缓存、流式分词、源码显示、编辑器渲染及 Diff 工具。公共入口提供组件和工具，`/engine` 提供异步分词，`/header` 供图表复用标题栏，`/i18n` 提供翻译包，`/styles.css` 提供独立样式。

消费者安装统一 i18n 与设置 Provider。源码直接显示，保留符号和尾换行，Mermaid 源码仍作为代码显示。本包不依赖 Markdown、文件打开器或 Shell 装配。运行 `pnpm --filter @workbench/code-highlighting test` 和 `typecheck`。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/code-highlight-policy.ts`, `lib/diff/range.ts`, `lib/diff/unified-patch.ts`, `lib/shiki-token-style.ts`.

实际调用示例：`src/index.ts` → `lib/code-highlight-policy.ts`.
