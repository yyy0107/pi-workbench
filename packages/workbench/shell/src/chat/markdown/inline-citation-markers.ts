const INLINE_CITATION_MARKER_OPEN = "[[cite:";

export const INLINE_CITATION_GROUP_SENTINEL = "workbench-inline-citations-7df47d9b";
export const INLINE_CITATION_URL_SENTINEL_PREFIX = "workbench-inline-citation-url-v1-7df47d9b:";

export interface InlineCitationUrlMarker {
  index: number;
  occurrence: number;
  url: string;
}

export interface InlineCitationPreprocessResult {
  text: string;
  markerCount: number;
}

function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password || !url.hostname) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function backtickRunLength(text: string, index: number): number {
  let cursor = index;
  while (text[cursor] === "`") cursor += 1;
  return cursor - index;
}

function matchingBacktickRunEnd(
  text: string,
  start: number,
  expectedLength: number,
): number | undefined {
  let cursor = start;
  while (cursor < text.length) {
    const next = text.indexOf("`", cursor);
    if (next < 0) return undefined;
    const length = backtickRunLength(text, next);
    if (length === expectedLength) return next + length;
    cursor = next + length;
  }
  return undefined;
}

function citationSentinel(index: number, occurrence: number, url: string): string {
  return `<sup>${INLINE_CITATION_URL_SENTINEL_PREFIX}${index}:${occurrence}:${encodeURIComponent(url)}</sup>`;
}

function replaceLineCitationMarkers(
  line: string,
  citationIndexByUrl: Map<string, number>,
  firstOccurrence: number,
): { text: string; markerCount: number } {
  let output = "";
  let markerCount = 0;
  let cursor = 0;

  while (cursor < line.length) {
    if (line[cursor] === "`") {
      const runLength = backtickRunLength(line, cursor);
      const codeEnd = matchingBacktickRunEnd(line, cursor + runLength, runLength);
      if (codeEnd !== undefined) {
        output += line.slice(cursor, codeEnd);
        cursor = codeEnd;
        continue;
      }
    }

    if (line.startsWith(INLINE_CITATION_MARKER_OPEN, cursor) && !isEscaped(line, cursor)) {
      const valueStart = cursor + INLINE_CITATION_MARKER_OPEN.length;
      const markerEnd = line.indexOf("]]", valueStart);
      if (markerEnd >= 0) {
        const url = safeHttpUrl(line.slice(valueStart, markerEnd));
        if (url) {
          let index = citationIndexByUrl.get(url);
          if (index === undefined) {
            index = citationIndexByUrl.size;
            citationIndexByUrl.set(url, index);
          }
          output += citationSentinel(index, firstOccurrence + markerCount, url);
          markerCount += 1;
          cursor = markerEnd + 2;
          continue;
        }
      }
    }

    output += line[cursor];
    cursor += 1;
  }

  return { text: output, markerCount };
}

function markdownFence(
  line: string,
): { character: "`" | "~"; length: number; rest: string } | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  const run = match?.[1];
  if (!run) return undefined;
  return {
    character: run[0] as "`" | "~",
    length: run.length,
    rest: match[2] ?? "",
  };
}

/**
 * Converts safe URL citation markers into raw-HTML sentinels consumed by the custom `sup`
 * renderer. Fenced, indented, and inline code remain literal Markdown examples.
 */
export function preprocessInlineCitationMarkers(text: string): InlineCitationPreprocessResult {
  const citationIndexByUrl = new Map<string, number>();
  let fence: { character: "`" | "~"; length: number } | undefined;
  let markerCount = 0;
  let output = "";
  let cursor = 0;

  while (cursor < text.length) {
    const lineBreak = text.indexOf("\n", cursor);
    const end = lineBreak < 0 ? text.length : lineBreak;
    const line = text.slice(cursor, end);
    const newline = lineBreak < 0 ? "" : "\n";
    const candidateFence = markdownFence(line.endsWith("\r") ? line.slice(0, -1) : line);

    if (fence) {
      output += line + newline;
      if (
        candidateFence?.character === fence.character &&
        candidateFence.length >= fence.length &&
        candidateFence.rest.trim() === ""
      ) {
        fence = undefined;
      }
    } else if (candidateFence) {
      fence = { character: candidateFence.character, length: candidateFence.length };
      output += line + newline;
    } else if (/^(?: {4}|\t)/.test(line)) {
      output += line + newline;
    } else {
      const replaced = replaceLineCitationMarkers(line, citationIndexByUrl, markerCount);
      output += replaced.text + newline;
      markerCount += replaced.markerCount;
    }

    cursor = lineBreak < 0 ? text.length : lineBreak + 1;
  }

  return { text: output, markerCount };
}

export function parseInlineCitationUrlSentinel(text: string): InlineCitationUrlMarker | undefined {
  if (!text.startsWith(INLINE_CITATION_URL_SENTINEL_PREFIX)) return undefined;
  const payload = text.slice(INLINE_CITATION_URL_SENTINEL_PREFIX.length);
  const indexSeparator = payload.indexOf(":");
  const occurrenceSeparator = payload.indexOf(":", indexSeparator + 1);
  if (indexSeparator <= 0 || occurrenceSeparator <= indexSeparator + 1) return undefined;

  const index = Number(payload.slice(0, indexSeparator));
  const occurrence = Number(payload.slice(indexSeparator + 1, occurrenceSeparator));
  if (!Number.isInteger(index) || index < 0 || !Number.isInteger(occurrence) || occurrence < 0) {
    return undefined;
  }

  try {
    const url = safeHttpUrl(decodeURIComponent(payload.slice(occurrenceSeparator + 1)));
    return url ? { index, occurrence, url } : undefined;
  } catch {
    return undefined;
  }
}
