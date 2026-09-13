export {
  MAX_HIGHLIGHTED_CODE_CHARACTERS,
  MAX_HIGHLIGHTED_CODE_LINES,
  shouldHighlightWorkbenchCode,
} from "../lib/code-highlight-policy";
export {
  languageForFilename,
  normalizeShikiLanguage,
  type WorkbenchShikiLanguage,
} from "./shiki-catalog";
export { useWorkbenchHighlightedCode } from "./use-workbench-highlighted-code";
export { useWorkbenchHighlightedLines } from "./use-workbench-highlighted-lines";
export {
  WorkbenchCodeEditor,
  WorkbenchCodeView,
  type WorkbenchCodeLineDecoration,
} from "./workbench-code-editor";
export * from "./code-theme-preview";

export * from "./workbench-code-block";
export { MarkdownCodeBlock } from "./markdown-code-block";
export { tokenStyle } from "../lib/shiki-token-style";
export * from "./diff/code-diff";
export * from "./diff/reviewable-diff";
export * from "../lib/diff/unified-patch";
export * from "../lib/diff/range";
