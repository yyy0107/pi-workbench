import { PASTED_TEXT_MIN_CHARACTERS } from "@workbench/agent-runtime-contracts/composer-attachments";

/** Own long text before Lexical's root listener parses/inserts the clipboard contents. */
export function addComposerTextFromPaste(
  event: {
    clipboardData: {
      files: ArrayLike<File>;
      items?: ArrayLike<{ kind: string }>;
      getData(type: string): string;
    } | null;
    preventDefault(): void;
    stopPropagation(): void;
  },
  addText: ((text: string) => Promise<void>) | undefined,
): boolean {
  if (
    !addText ||
    !event.clipboardData ||
    event.clipboardData.files.length ||
    Array.from(event.clipboardData.items ?? []).some((item) => item.kind === "file")
  )
    return false;
  const text = event.clipboardData.getData("text/plain");
  if (text.length < PASTED_TEXT_MIN_CHARACTERS) return false;
  event.preventDefault();
  event.stopPropagation();
  void addText(text);
  return true;
}
