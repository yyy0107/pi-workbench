export {
  MAX_HIGHLIGHTED_CODE_CHARACTERS,
  MAX_HIGHLIGHTED_CODE_LINES,
  shouldHighlightWorkbenchCode,
} from "./code-highlight-policy";
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
