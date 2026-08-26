import { deriveSessionDisplayTitle } from "./session-display-title";

const PROMPT_PREVIEW_CHARACTERS = 32;

export function sessionContextTracePromptPreview(prompt: string): string | undefined {
  return (
    deriveSessionDisplayTitle(prompt, { maxCharacters: PROMPT_PREVIEW_CHARACTERS + 1 }) || undefined
  );
}
