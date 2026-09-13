interface ClipboardFileItem {
  readonly kind: string;
  readonly type: string;
  getAsFile(): File | null;
}

interface ComposerFilePasteEvent {
  readonly clipboardData: {
    readonly files?: ArrayLike<File>;
    readonly items?: ArrayLike<ClipboardFileItem>;
  } | null;
  preventDefault(): void;
  stopPropagation(): void;
}

interface ComposerFilePasteTarget {
  readonly attachmentsEnabled: boolean;
  addAttachment(file: File): Promise<void>;
}

function isClipboardAttachment(file: File): boolean {
  // Clipboard text/HTML representations must remain available to Lexical as ordinary paste.
  return !file.type.startsWith("text/");
}

export function composerClipboardFiles(
  clipboardData: ComposerFilePasteEvent["clipboardData"],
): File[] {
  if (!clipboardData) return [];

  const files = Array.from(clipboardData.files ?? []).filter(isClipboardAttachment);
  if (files.length > 0) return files;

  return Array.from(clipboardData.items ?? []).flatMap((item) => {
    if (item.kind !== "file" || item.type.startsWith("text/")) return [];
    const file = item.getAsFile();
    return file && isClipboardAttachment(file) ? [file] : [];
  });
}

export async function addComposerFilesFromPaste(
  event: ComposerFilePasteEvent,
  target: ComposerFilePasteTarget,
): Promise<boolean> {
  if (!target.attachmentsEnabled) return false;

  const files = composerClipboardFiles(event.clipboardData);
  if (files.length === 0) return false;

  event.preventDefault();
  // Lexical handles paste in its own root listener. Stop the file paste here so it does not also
  // insert a clipboard text/HTML representation.
  event.stopPropagation();
  await Promise.all(
    files.map(async (file) => {
      try {
        await target.addAttachment(file);
      } catch {
        // The runtime publishes the attachment error before rejecting.
      }
    }),
  );
  return true;
}

/** @deprecated Compatibility aliases for the previous image-only API names. */
export const composerClipboardImages = composerClipboardFiles;
export const addComposerImagesFromPaste = addComposerFilesFromPaste;
