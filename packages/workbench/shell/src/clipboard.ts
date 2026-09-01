export interface ClipboardTextWriter {
  writeText(value: string): Promise<void>;
}

export type ClipboardTextFallback = (value: string) => boolean;

function browserClipboard(): ClipboardTextWriter | undefined {
  try {
    if (typeof navigator === "undefined") return undefined;
    return navigator.clipboard;
  } catch {
    return undefined;
  }
}

function browserClipboardFallback(): ClipboardTextFallback | undefined {
  if (typeof document === "undefined" || !document.body) return undefined;

  return (value) => {
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const selection = document.getSelection();
    const selectedRanges = selection
      ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
      : [];
    const textarea = document.createElement("textarea");

    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.inset = "0 auto auto -9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, value.length);

    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
      if (selection) {
        selection.removeAllRanges();
        for (const range of selectedRanges) selection.addRange(range);
      }
      activeElement?.focus({ preventScroll: true });
    }
  };
}

/** Writes text with a DOM fallback while containing Clipboard permission failures. */
export async function writeClipboardText(
  value: string,
  clipboard: ClipboardTextWriter | undefined = browserClipboard(),
  fallback: ClipboardTextFallback | undefined = browserClipboardFallback(),
): Promise<boolean> {
  if (clipboard) {
    try {
      const writeText = clipboard.writeText;
      if (typeof writeText === "function") {
        await writeText.call(clipboard, value);
        return true;
      }
    } catch {
      // Permission and secure-context failures can still use the DOM fallback below.
    }
  }

  try {
    return fallback?.(value) === true;
  } catch {
    return false;
  }
}
