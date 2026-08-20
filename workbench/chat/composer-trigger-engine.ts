export interface ComposerTriggerInput {
  value: string;
  cursorPosition: number;
  isComposing: boolean;
}

export interface ComposerTriggerContext {
  value: string;
  cursorPosition: number;
  tokenStart: number;
  tokenEnd: number;
  token: string;
  query: string;
}

export interface ComposerTriggerDefinition<TItem> {
  id: string;
  character: string;
  search(query: string, context: ComposerTriggerContext): readonly TItem[];
  isExcluded?(context: ComposerTriggerContext): boolean;
}

export interface ComposerTriggerMatch<TItem> extends ComposerTriggerContext {
  triggerId: string;
  triggerCharacter: string;
  suggestions: readonly TItem[];
  key: string;
}

const isTokenBoundary = (character: string | undefined) =>
  character === undefined ||
  character === " " ||
  character === "\t" ||
  character === "\n" ||
  character === "\r";

function tokenRange(value: string, cursorPosition: number): { start: number; end: number } {
  let start = cursorPosition;
  while (start > 0 && !isTokenBoundary(value[start - 1])) start -= 1;

  let end = cursorPosition;
  while (end < value.length && !isTokenBoundary(value[end])) end += 1;

  return { start, end };
}

function isInsideBackticks(value: string, tokenStart: number): boolean {
  let delimiterLength = 0;

  for (let index = 0; index < tokenStart;) {
    if (value[index] !== "`" || value[index - 1] === "\\") {
      index += 1;
      continue;
    }

    let runEnd = index + 1;
    while (runEnd < tokenStart && value[runEnd] === "`") runEnd += 1;
    const runLength = runEnd - index;
    if (delimiterLength === 0) delimiterLength = runLength;
    else if (runLength === delimiterLength) delimiterLength = 0;
    index = runEnd;
  }

  return delimiterLength !== 0;
}

export function excludeSlashPathOrCode(context: ComposerTriggerContext): boolean {
  if (isInsideBackticks(context.value, context.tokenStart)) return true;
  const lineStart = context.value.lastIndexOf("\n", context.tokenStart - 1) + 1;
  const linePrefix = context.value.slice(lineStart, context.tokenStart);
  if (/^(?: {4,}|\t)/.test(linePrefix)) return true;

  const pathCandidate = context.token.slice(1);
  return (
    pathCandidate.startsWith(".") ||
    pathCandidate.startsWith("~") ||
    pathCandidate.includes("/") ||
    pathCandidate.includes("\\") ||
    !/^[\p{L}\p{N}_.:-]*$/u.test(context.query)
  );
}

export class ComposerTriggerEngine<TItem> {
  readonly #triggers: readonly ComposerTriggerDefinition<TItem>[];

  constructor(triggers: readonly ComposerTriggerDefinition<TItem>[]) {
    this.#triggers = triggers;
  }

  detect(input: ComposerTriggerInput): ComposerTriggerMatch<TItem> | undefined {
    if (input.isComposing) return undefined;
    if (
      !Number.isInteger(input.cursorPosition) ||
      input.cursorPosition < 0 ||
      input.cursorPosition > input.value.length
    ) {
      return undefined;
    }

    const { start, end } = tokenRange(input.value, input.cursorPosition);
    const token = input.value.slice(start, end);
    const trigger = this.#triggers.find(
      (candidate) =>
        token.startsWith(candidate.character) &&
        input.cursorPosition >= start + candidate.character.length,
    );
    if (!trigger || !isTokenBoundary(input.value[start - 1])) return undefined;

    const query = input.value.slice(start + trigger.character.length, input.cursorPosition);
    const context: ComposerTriggerContext = {
      value: input.value,
      cursorPosition: input.cursorPosition,
      tokenStart: start,
      tokenEnd: end,
      token,
      query,
    };
    if (trigger.isExcluded?.(context)) return undefined;

    const suggestions = trigger.search(query, context);
    if (suggestions.length === 0) return undefined;

    return {
      ...context,
      triggerId: trigger.id,
      triggerCharacter: trigger.character,
      suggestions,
      key: `${trigger.id}:${start}:${end}:${query}`,
    };
  }
}
