export interface ClipboardTextWriter {
  writeText(value: string): Promise<void>;
}

function browserClipboard(): ClipboardTextWriter | undefined {
  try {
    if (typeof navigator === "undefined") return undefined;
    return navigator.clipboard;
  } catch {
    return undefined;
  }
}

/** Writes text without allowing Clipboard permission failures to escape the user gesture. */
export async function writeClipboardText(
  value: string,
  clipboard: ClipboardTextWriter | undefined = browserClipboard(),
): Promise<boolean> {
  try {
    if (!clipboard || typeof clipboard.writeText !== "function") return false;
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
