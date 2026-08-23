import type { ProgressiveTextDocument } from "./progressive-text-document";

const HIGHLIGHT_PAGE_LINE_COUNT = 32;
const HIGHLIGHT_CONTEXT_LINE_COUNT = 24;
const MAX_HIGHLIGHT_WINDOW_CHARACTERS = 16 * 1024;
const MAX_HIGHLIGHT_CONTEXT_CHARACTERS = 4 * 1024;
const MAX_HIGHLIGHT_LINE_CHARACTERS = 4 * 1024;

export interface VirtualizedCodeWindow {
  code: string;
  contextCode?: string;
  endLine: number;
  highlightedLineLengths: readonly number[];
  startLine: number;
}

function boundedLines(
  document: ProgressiveTextDocument,
  startLine: number,
  endLine: number,
  totalCharacterBudget: number,
): { code: string; lengths: readonly number[] } {
  const lineCount = Math.max(1, endLine - startLine);
  const lines = Array.from({ length: lineCount }, (_, offset) =>
    document.lineAt(startLine + offset),
  );
  const desiredLengths = lines.map((line) => Math.min(line.length, MAX_HIGHLIGHT_LINE_CHARACTERS));
  const characterBudget = Math.max(1, totalCharacterBudget - Math.max(0, lineCount - 1));
  const desiredTotal = desiredLengths.reduce((total, length) => total + length, 0);
  let lengths = desiredLengths;

  if (desiredTotal > characterBudget) {
    let lower = 0;
    let upper = MAX_HIGHLIGHT_LINE_CHARACTERS;
    while (lower < upper) {
      const candidate = Math.ceil((lower + upper) / 2);
      const used = desiredLengths.reduce((total, length) => total + Math.min(length, candidate), 0);
      if (used <= characterBudget) lower = candidate;
      else upper = candidate - 1;
    }

    lengths = desiredLengths.map((length) => Math.min(length, lower));
    let remaining = characterBudget - lengths.reduce((total, length) => total + length, 0);
    for (let index = 0; index < lengths.length && remaining > 0; index += 1) {
      const available = desiredLengths[index]! - lengths[index]!;
      const added = Math.min(available, remaining);
      lengths[index]! += added;
      remaining -= added;
    }
  }

  return {
    code: lines.map((line, index) => line.slice(0, lengths[index])).join("\n"),
    lengths,
  };
}

export function createVirtualizedCodeWindow(
  document: ProgressiveTextDocument,
  firstVirtualLine: number | undefined,
  lastVirtualLine: number | undefined,
  lineCount: number,
): VirtualizedCodeWindow | undefined {
  if (
    firstVirtualLine === undefined ||
    lastVirtualLine === undefined ||
    lineCount <= 0 ||
    firstVirtualLine < 0 ||
    lastVirtualLine < firstVirtualLine
  ) {
    return undefined;
  }

  const startLine =
    Math.floor(firstVirtualLine / HIGHLIGHT_PAGE_LINE_COUNT) * HIGHLIGHT_PAGE_LINE_COUNT;
  const endLine = Math.min(
    lineCount,
    (Math.floor(lastVirtualLine / HIGHLIGHT_PAGE_LINE_COUNT) + 1) * HIGHLIGHT_PAGE_LINE_COUNT,
  );
  const visible = boundedLines(document, startLine, endLine, MAX_HIGHLIGHT_WINDOW_CHARACTERS);
  const contextStartLine = Math.max(0, startLine - HIGHLIGHT_CONTEXT_LINE_COUNT);
  const context =
    contextStartLine < startLine
      ? boundedLines(document, contextStartLine, startLine, MAX_HIGHLIGHT_CONTEXT_CHARACTERS).code
      : undefined;

  return {
    code: visible.code,
    ...(context ? { contextCode: context } : {}),
    endLine,
    highlightedLineLengths: visible.lengths,
    startLine,
  };
}
