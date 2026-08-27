const DEFAULT_TITLE_CHARACTERS = 60;
const USER_REQUEST_OPEN = "<user-request>";
const USER_REQUEST_CLOSE = "</user-request>";
const INTERNAL_ENVELOPE_PATTERN =
  /<workbench-[a-z0-9-]+(?:\s[^>]*)?>[\s\S]*?<\/workbench-[a-z0-9-]+\s*>/giu;
const RESIDUAL_INTERNAL_ENVELOPE_PATTERN = /<workbench-[a-z0-9-]+(?:\s[^>]*)?>[\s\S]*$/iu;
const INTERNAL_CLOSING_TAG_PATTERN = /<\/workbench-[a-z0-9-]+\s*>/giu;
const MARKDOWN_FENCE_PATTERN = /^```[^\n]*\n([\s\S]*?)(?:\n```\s*)?$/u;
const PATH_PATTERN = /^(?:[a-z]:[\\/]|~?[\\/]|\.\.?[\\/])\S+$/iu;
const COMPOSER_COMMAND_DIRECTIVE_PATTERN =
  /:(?:workbench-command|pi-command|workbench-command-argument-end)\[[^|\]\n]{1,2048}\|([^\]\n]{1,4096})\]/gu;
const COMPOSER_SKILL_LINK_PATTERN =
  /\[\$((?:\\.|[^\]\\\n]){1,4096})\]\(skill:\/\/(?:user|project)\/[^\s)\n]{1,2048}\)/gu;

export interface SessionDisplayTitleOptions {
  fallback?: string;
  maxCharacters?: number;
}

function explicitUserRequest(value: string): string | undefined {
  const start = value.indexOf(USER_REQUEST_OPEN);
  const end = value.lastIndexOf(USER_REQUEST_CLOSE);
  if (start < 0 || end < start + USER_REQUEST_OPEN.length) return undefined;
  return value.slice(start + USER_REQUEST_OPEN.length, end);
}

function stripInternalEnvelopes(value: string, stripUserRequestTags: boolean): string {
  let current = value;
  let previous: string;
  do {
    previous = current;
    current = current.replace(INTERNAL_ENVELOPE_PATTERN, " ");
  } while (current !== previous);

  const withoutWorkbenchTags = current
    .replace(RESIDUAL_INTERNAL_ENVELOPE_PATTERN, " ")
    .replace(INTERNAL_CLOSING_TAG_PATTERN, " ");
  return stripUserRequestTags
    ? withoutWorkbenchTags.replaceAll(USER_REQUEST_OPEN, " ").replaceAll(USER_REQUEST_CLOSE, " ")
    : withoutWorkbenchTags;
}

function decodeComposerLabel(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function stripComposerProtocol(value: string): string {
  return value
    .replace(COMPOSER_SKILL_LINK_PATTERN, (_match, label: string) =>
      label.replace(/\\([\\\]])/gu, "$1"),
    )
    .replace(COMPOSER_COMMAND_DIRECTIVE_PATTERN, (_match, label: string) =>
      decodeComposerLabel(label),
    );
}

function compactPath(value: string): string {
  if (!PATH_PATTERN.test(value)) return value;
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 2) return value;
  return `…/${segments.slice(-2).join("/")}`;
}

function firstMeaningfulLine(value: string): string {
  const fenced = MARKDOWN_FENCE_PATTERN.exec(value.trim())?.[1] ?? value;
  return (
    fenced
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line && line !== "```") ?? ""
  );
}

function truncateTitle(value: string, maxCharacters: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxCharacters) return value;
  return `${characters.slice(0, Math.max(1, maxCharacters - 1)).join("")}…`;
}

/**
 * Produces navigation-safe session copy from either canonical user text or Pi's compiled prompt.
 * Internal Workbench envelopes are never allowed to become conversation chrome.
 */
export function deriveSessionDisplayTitle(
  source: string | undefined,
  options: Readonly<SessionDisplayTitleOptions> = {},
): string {
  const fallback = options.fallback?.trim() ?? "";
  if (!source?.trim()) return fallback;

  const userRequest = explicitUserRequest(source);
  const withoutInternalProtocol = stripInternalEnvelopes(
    userRequest ?? source,
    userRequest === undefined,
  );
  const normalized = firstMeaningfulLine(stripComposerProtocol(withoutInternalProtocol))
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return fallback;

  const maxCharacters = Math.max(2, options.maxCharacters ?? DEFAULT_TITLE_CHARACTERS);
  return truncateTitle(compactPath(normalized), maxCharacters);
}
