const PROMPT_PREVIEW_CHARACTERS = 32;
const USER_REQUEST_PATTERN = /<user-request>\s*([\s\S]*?)\s*<\/user-request>/iu;
const UNTRUSTED_CONTEXT_PATTERN =
  /<workbench-untrusted-context>[\s\S]*?<\/workbench-untrusted-context>/giu;

export function sessionContextTracePromptPreview(prompt: string): string | undefined {
  const explicitUserRequest = USER_REQUEST_PATTERN.exec(prompt)?.[1]?.trim();
  const withoutInjectedContext = (explicitUserRequest || prompt)
    .replace(UNTRUSTED_CONTEXT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!withoutInjectedContext) return undefined;
  const characters = Array.from(withoutInjectedContext);
  return characters.length <= PROMPT_PREVIEW_CHARACTERS
    ? withoutInjectedContext
    : `${characters.slice(0, PROMPT_PREVIEW_CHARACTERS).join("")}…`;
}
