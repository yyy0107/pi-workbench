import { stripVTControlCharacters } from "node:util";

const ESCAPE = "\u001b";
const BELL = "\u0007";
const STRING_ESCAPE_INTRODUCERS = new Set(["]", "P", "X", "^", "_"]);
const CHARACTER_SET_INTRODUCERS = new Set(["(", ")", "*", "+", "-", ".", "/", "%"]);
const DEFAULT_MAX_PENDING_LINE_CHARS = 64 * 1024;
const MAX_ESCAPE_CARRY_CHARS = 8 * 1024;

function isCompleteEscapeSequence(value: string): boolean {
  if (!value.startsWith(ESCAPE)) return true;
  if (value.length < 2) return false;

  const introducer = value[1]!;
  if (introducer === "[") {
    return Array.from(value.slice(2)).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x40 && code <= 0x7e;
    });
  }
  if (STRING_ESCAPE_INTRODUCERS.has(introducer)) {
    return value.includes(BELL, 2) || value.includes(`${ESCAPE}\\`, 2);
  }
  if (CHARACTER_SET_INTRODUCERS.has(introducer)) return value.length >= 3;
  return true;
}

function splitTrailingEscapeSequence(value: string): { text: string; carry: string } {
  const escapeIndex = value.lastIndexOf(ESCAPE);
  if (escapeIndex < 0) return { text: value, carry: "" };

  const suffix = value.slice(escapeIndex);
  if (isCompleteEscapeSequence(suffix) || suffix.length > MAX_ESCAPE_CARRY_CHARS) {
    return { text: value, carry: "" };
  }
  return { text: value.slice(0, escapeIndex), carry: suffix };
}

/** Stateful ANSI stripping for PTY chunks whose control sequences may cross chunk boundaries. */
export class TerminalAnsiTextDecoder {
  #carry = "";

  feed(data: string): string {
    if (!data) return "";
    const { text, carry } = splitTrailingEscapeSequence(`${this.#carry}${data}`);
    this.#carry = carry;
    return stripVTControlCharacters(text);
  }

  flush(): string {
    const text = stripVTControlCharacters(this.#carry);
    this.#carry = "";
    return text;
  }

  reset(): void {
    this.#carry = "";
  }
}

/**
 * Projects a raw terminal stream into append-only semantic text for the Pi tool result.
 * Carriage-return redraws stay buffered until a newline or process exit makes the line stable.
 */
export class TerminalTranscriptProjector {
  readonly #decoder = new TerminalAnsiTextDecoder();
  readonly #maxPendingLineChars: number;
  #pendingLine = "";
  #pendingCarriageReturn = false;

  constructor(options: { maxPendingLineChars?: number } = {}) {
    this.#maxPendingLineChars = Math.max(
      1,
      options.maxPendingLineChars ?? DEFAULT_MAX_PENDING_LINE_CHARS,
    );
  }

  feed(data: string): string {
    return this.#consume(this.#decoder.feed(data));
  }

  flush(): string {
    let output = this.#consume(this.#decoder.flush());
    this.#pendingCarriageReturn = false;
    if (this.#pendingLine) {
      output += this.#pendingLine;
      this.#pendingLine = "";
    }
    return output;
  }

  reset(): void {
    this.#decoder.reset();
    this.#pendingLine = "";
    this.#pendingCarriageReturn = false;
  }

  #consume(text: string): string {
    let output = "";
    for (const character of text) {
      if (this.#pendingCarriageReturn) {
        this.#pendingCarriageReturn = false;
        if (character === "\n") {
          output += `${this.#pendingLine}\n`;
          this.#pendingLine = "";
          continue;
        }
        this.#pendingLine = "";
      }

      if (character === "\r") {
        this.#pendingCarriageReturn = true;
        continue;
      }
      if (character === "\n") {
        output += `${this.#pendingLine}\n`;
        this.#pendingLine = "";
        continue;
      }
      if (character === "\b" || character === "\u007f") {
        this.#pendingLine = Array.from(this.#pendingLine).slice(0, -1).join("");
        continue;
      }

      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint < 0x20 && character !== "\t") continue;
      this.#pendingLine += character;
      if (this.#pendingLine.length > this.#maxPendingLineChars) {
        const overflow = this.#pendingLine.length - this.#maxPendingLineChars;
        output += this.#pendingLine.slice(0, overflow);
        this.#pendingLine = this.#pendingLine.slice(overflow);
      }
    }
    return output;
  }
}
