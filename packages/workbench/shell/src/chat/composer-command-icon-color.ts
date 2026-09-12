import type { ComposerTriggerItem } from "./composer-directive";

export const COMPOSER_COMMAND_TOKEN_ICON_ACCENT_CLASS_NAME =
  "aui-composer-command-token-icon-accent";

export const COMPOSER_COMMAND_ICON_COLOR_CLASSES = [
  "aui-composer-command-icon-teal",
  "aui-composer-command-icon-blue",
  "aui-composer-command-icon-purple",
  "aui-composer-command-icon-muted",
] as const;

export function composerCommandIconColorIndex(commandId: string): number {
  let hash = 0;
  for (const character of commandId) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return hash % COMPOSER_COMMAND_ICON_COLOR_CLASSES.length;
}

export function composerCommandIconColorClassName(commandId: string): string {
  return COMPOSER_COMMAND_ICON_COLOR_CLASSES[composerCommandIconColorIndex(commandId)]!;
}

export function composerCommandIconColorMap(
  items: readonly Pick<ComposerTriggerItem, "id" | "type">[],
  isIncluded: (item: Pick<ComposerTriggerItem, "id" | "type">) => boolean = () => true,
): Map<string, string> {
  const colorBySuggestionKey = new Map<string, string>();
  let previousColorIndex: number | undefined;
  for (const item of items) {
    if (!isIncluded(item)) continue;
    let colorIndex = composerCommandIconColorIndex(item.id);
    if (colorIndex === previousColorIndex) {
      colorIndex = (colorIndex + 1) % COMPOSER_COMMAND_ICON_COLOR_CLASSES.length;
    }
    colorBySuggestionKey.set(
      `${item.type}:${item.id}`,
      COMPOSER_COMMAND_ICON_COLOR_CLASSES[colorIndex]!,
    );
    previousColorIndex = colorIndex;
  }
  return colorBySuggestionKey;
}
