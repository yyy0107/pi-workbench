export const MAX_HIGHLIGHTED_CODE_CHARACTERS = 100_000;
export const MAX_HIGHLIGHTED_CODE_LINES = 2_000;

export function shouldHighlightWorkbenchCode(code: string): boolean {
  if (code.length > MAX_HIGHLIGHTED_CODE_CHARACTERS) return false;

  let lineCount = 1;
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) !== 10) continue;
    lineCount += 1;
    if (lineCount > MAX_HIGHLIGHTED_CODE_LINES) return false;
  }

  return true;
}
