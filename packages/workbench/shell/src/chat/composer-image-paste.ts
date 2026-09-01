interface ClipboardFileItem {
  readonly kind: string;
  readonly type: string;
  getAsFile(): File | null;
}

interface ComposerImagePasteEvent {
  readonly clipboardData: {
    readonly files?: ArrayLike<File>;
    readonly items?: ArrayLike<ClipboardFileItem>;
  } | null;
  preventDefault(): void;
  stopPropagation(): void;
}

interface ComposerImagePasteTarget {
  readonly attachmentsEnabled: boolean;
  addAttachment(file: File): Promise<void>;
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

export function composerClipboardImages(
  clipboardData: ComposerImagePasteEvent["clipboardData"],
): File[] {
  if (!clipboardData) return [];

  const files = Array.from(clipboardData.files ?? []).filter(isImage);
  if (files.length > 0) return files;

  return Array.from(clipboardData.items ?? []).flatMap((item) => {
    if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
    const file = item.getAsFile();
    return file && isImage(file) ? [file] : [];
  });
}

export async function addComposerImagesFromPaste(
  event: ComposerImagePasteEvent,
  target: ComposerImagePasteTarget,
): Promise<boolean> {
  if (!target.attachmentsEnabled) return false;

  const images = composerClipboardImages(event.clipboardData);
  if (images.length === 0) return false;

  event.preventDefault();
  // Lexical handles paste in its own root listener. Stop the image paste here
  // so it does not also insert a clipboard text/HTML representation.
  event.stopPropagation();
  await Promise.all(
    images.map(async (image) => {
      try {
        await target.addAttachment(image);
      } catch {
        // assistant-ui emits composer.attachmentAddError before rejecting.
      }
    }),
  );
  return true;
}
