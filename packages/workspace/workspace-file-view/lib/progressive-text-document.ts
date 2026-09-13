export const LARGE_TEXT_FILE_THRESHOLD_BYTES = 512 * 1024;

export function isLargeTextFile(size: number): boolean {
  return size >= LARGE_TEXT_FILE_THRESHOLD_BYTES;
}

export interface ProgressiveTextSnapshot {
  lineCount: number;
  longestLineLength: number;
  loadedBytes: number;
  totalBytes?: number;
}

function withoutCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

interface TextLineBlock {
  text: string;
  starts: Uint32Array;
  startLine: number;
  terminated: boolean;
}

export class ProgressiveTextDocument {
  readonly #blocks: TextLineBlock[] = [];
  #partialLine = "";
  #receivedText = false;
  #complete = false;
  #completedLineCount = 0;
  #loadedBytes = 0;
  #totalBytes?: number;
  #longestLineLength = 0;

  constructor(totalBytes?: number) {
    this.#totalBytes = totalBytes;
  }

  append(text: string, loadedBytes: number, totalBytes?: number): void {
    if (this.#complete) throw new Error("Cannot append to a completed text document");
    this.#loadedBytes = loadedBytes;
    if (totalBytes !== undefined) this.#totalBytes = totalBytes;
    if (!text) return;

    this.#receivedText = true;
    const combined = `${this.#partialLine}${text}`;
    const lastNewline = combined.lastIndexOf("\n");
    if (lastNewline < 0) {
      this.#partialLine = combined;
      return;
    }

    this.#appendBlock(combined.slice(0, lastNewline + 1), true);
    this.#partialLine = combined.slice(lastNewline + 1);
  }

  finish(loadedBytes = this.#loadedBytes, totalBytes = this.#totalBytes): void {
    if (this.#complete) return;
    this.#loadedBytes = loadedBytes;
    this.#totalBytes = totalBytes;
    this.#appendBlock(this.#partialLine, false);
    this.#partialLine = "";
    this.#complete = true;
  }

  lineAt(index: number): string {
    if (!this.#complete && this.#receivedText && index === this.#completedLineCount) {
      return withoutCarriageReturn(this.#partialLine);
    }

    let low = 0;
    let high = this.#blocks.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const block = this.#blocks[middle];
      if (!block) return "";
      if (index < block.startLine) {
        high = middle - 1;
        continue;
      }
      if (index >= block.startLine + block.starts.length) {
        low = middle + 1;
        continue;
      }

      const localIndex = index - block.startLine;
      const start = block.starts[localIndex] ?? 0;
      const nextStart = block.starts[localIndex + 1];
      let end =
        nextStart === undefined
          ? block.terminated
            ? block.text.length - 1
            : block.text.length
          : nextStart - 1;
      if (end > start && block.text.charCodeAt(end - 1) === 13) end -= 1;
      return block.text.slice(start, end);
    }
    return "";
  }

  snapshot(): ProgressiveTextSnapshot {
    const pendingLineCount = !this.#complete && this.#receivedText ? 1 : 0;
    return {
      lineCount: this.#completedLineCount + pendingLineCount,
      longestLineLength: Math.max(this.#longestLineLength, this.#partialLine.length),
      loadedBytes: this.#loadedBytes,
      ...(this.#totalBytes === undefined ? {} : { totalBytes: this.#totalBytes }),
    };
  }

  #appendBlock(text: string, terminated: boolean): void {
    const starts: number[] = [];
    let lineStart = 0;
    if (terminated) {
      for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) !== 10) continue;
        starts.push(lineStart);
        const carriageReturn = index > lineStart && text.charCodeAt(index - 1) === 13 ? 1 : 0;
        this.#longestLineLength = Math.max(
          this.#longestLineLength,
          index - lineStart - carriageReturn,
        );
        lineStart = index + 1;
      }
    } else {
      starts.push(0);
      this.#longestLineLength = Math.max(
        this.#longestLineLength,
        withoutCarriageReturn(text).length,
      );
    }

    this.#blocks.push({
      text,
      starts: Uint32Array.from(starts),
      startLine: this.#completedLineCount,
      terminated,
    });
    this.#completedLineCount += starts.length;
  }
}
