# Markdown 能力

拥有 Markdown/GFM/公式、流式分段渲染、Mermaid、引用和 Markdown 预览。根公开入口延迟加载正文，`/render` 为直接渲染入口，`/i18n` 与 `/styles.css` 提供词典和样式；源码显示由 `@workbench/code-highlighting` 拥有。

宿主安装统一 i18n/设置 Provider，并安装 Markdown 和代码高亮词典。Product 通过 `MarkdownLinkAdapterProvider` 传入文件判定与 FileLink 组件，二者固定为同一安装快照；预处理和延迟渲染使用同一 Context。本包不依赖工作区或文件查看器。

保留 DeepSeek 衍生增量解析器的署名与许可证。测试覆盖增量解析、Unicode、显示时钟、链接过滤、异步加载与安装隔离；运行 `pnpm --filter @workbench/markdown test` 和 `typecheck`。

包内分工：src/ 放能力实现、契约、组件及装配，词典/样式随组件共置；lib/ 放下列内部辅助源码，tests/ 放测试。两处源码最多一级子目录。能力和辅助源码统一保留 TS/TSX，由所属包与消费者进行类型检查。

内部辅助：`lib/inline-citation-markers.ts`, `lib/markdown-normalize.ts`.

实际调用示例：`src/markdown-text.tsx` → `lib/markdown-normalize.ts`.
