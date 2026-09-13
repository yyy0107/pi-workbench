const MAX_TERMINAL_TAB_TITLE_LENGTH = 160;
const PROMPT_MARKER_PATTERN = /^(.+?)(?:[$#%>❯➜])(?:\s.*)?$/u;

function sanitizeTerminalTabTitle(value: string): string | undefined {
  const normalized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  })
    .join("")
    .replaceAll(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

export function normalizeTerminalTabTitle(value: string): string | undefined {
  const normalized = sanitizeTerminalTabTitle(value);
  if (!normalized) return undefined;

  const characters = Array.from(normalized);
  return characters.length > MAX_TERMINAL_TAB_TITLE_LENGTH
    ? `${characters.slice(0, MAX_TERMINAL_TAB_TITLE_LENGTH - 1).join("")}…`
    : normalized;
}

export function terminalTabTitleFromPrompt(value: string): string | undefined {
  const normalized = sanitizeTerminalTabTitle(value);
  if (!normalized) return undefined;

  const match = normalized.match(PROMPT_MARKER_PATTERN);
  if (!match) return undefined;

  const prefix = match[1]?.trim() ?? "";
  if (!prefix || (!/[@:~]/.test(prefix) && /\s/.test(prefix))) return undefined;
  return normalizeTerminalTabTitle(prefix);
}
