export const DEFAULT_COMMAND_PALETTE_SHORTCUT: readonly string[] = Object.freeze(["Mod", "K"]);

export function normalizeCommandPaletteShortcut(
  shortcut: readonly string[] | string,
): readonly string[] {
  return typeof shortcut === "string" ? shortcut.split("+").map((token) => token.trim()) : shortcut;
}

export function isCommandPaletteEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
