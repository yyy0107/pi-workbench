# Workbench Markdown

`MarkdownTextContent`, `MarkdownTextContentWithCitations`, and
`MarkdownCodeBlockContent` remain the public message/preview entry points.
Rendering and styling are owned by Shell.

- `incremental-markdown.ts` freezes stable blocks, retains two trailing blocks,
  and incrementally parses completed lines in an open top-level code fence.
  It is adapted from DeepSeek Harness at `c291e796`; attribution and the MIT
  license are preserved in `DEEPSEEK-LICENSE.txt`.
- `markdown-pipeline.ts` owns GFM/math parsing and the sanitized HAST pipeline.
  Authored HTML is sanitized before trusted KaTeX output and internal React
  component tags are added. Fragment IDs are scoped to each message.
- `workbench-markdown.tsx` memoizes block rendering with source-offset keys.
  Reference definitions, footnotes, and block HTML use a full-document parse
  because later content can change earlier nodes. Incomplete prose is repaired
  only in the active tail; completed blocks and code are not repaired.
- `markdown-reveal.tsx` uses one animation-frame clock per message. It reveals
  Unicode graphemes directly in text nodes, with a 16 ms base interval and a
  160 ms scheduling horizon. Large bursts compress the interval. Completion
  and reduced-motion preferences show the full text immediately. This is an
  animation budget, not a measured model TPS limit.
- `markdown-code-block.tsx` loads highlighting after the code enters the
  viewport. It uses Shell's shared Shiki instance, grammar loaders, appearance
  themes, and code-size budgets. `createWorkbenchCodeStream` retains completed
  line tokens and grammar state; edits or theme/language changes reset it.
- `markdown-text.tsx`, `markdown-link-icons.tsx`, and `mermaid-code.tsx` keep
  Shell's source citations, file opener, external-link confirmation, diagram
  rendering, and shared code controls. Mermaid initialization/rendering is
  serialized because its configuration is global.

Styles belong to `markdown.css` under `.aui-markdown` and `data-markdown`
markers. The Web and desktop hosts consume the shared Shell stylesheet.

Validation covers streamed/full parse equivalence, bounded open-fence parsing,
replacement input, cross-block references, Unicode boundaries, clock cleanup,
HTML/link filtering, math, citations, and incremental/full highlight parity.
A long unfinished paragraph can still grow the unstable tail; the parser does
not claim constant work for all Markdown shapes.
