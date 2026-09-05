export const MIN_COMPOSER_INDEX_GAP = 36;

export interface UserMessageIndexLayoutInput {
  composerStart: number;
  threadStart: number;
  layoutAllowsIndex?: boolean;
}

export interface VerticalBounds {
  top: number;
  bottom: number;
}

export function getMessageElements(root: HTMLElement): Map<string, HTMLElement> {
  return new Map(
    Array.from(root.querySelectorAll<HTMLElement>("[data-message-id]"), (element) => [
      element.dataset.messageId!,
      element,
    ]),
  );
}

export function resolveComposerIndexGap({
  composerStart,
  threadStart,
}: UserMessageIndexLayoutInput): number {
  return composerStart - threadStart;
}

export function shouldShowUserMessageIndex(layout: UserMessageIndexLayoutInput): boolean {
  if (layout.layoutAllowsIndex === false) return false;
  const gap = resolveComposerIndexGap(layout);
  return Number.isFinite(gap) && gap > MIN_COMPOSER_INDEX_GAP;
}

export function isMessageInViewport(
  messageBounds: VerticalBounds,
  viewportBounds: VerticalBounds,
): boolean {
  return messageBounds.bottom > viewportBounds.top && messageBounds.top < viewportBounds.bottom;
}
