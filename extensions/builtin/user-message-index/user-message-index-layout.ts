export const MIN_COMPOSER_INDEX_GAP = 36;

export interface UserMessageIndexLayoutInput {
  composerStart: number;
  threadStart: number;
}

export function resolveComposerIndexGap({
  composerStart,
  threadStart,
}: UserMessageIndexLayoutInput): number {
  return composerStart - threadStart;
}

export function shouldShowUserMessageIndex(layout: UserMessageIndexLayoutInput): boolean {
  const gap = resolveComposerIndexGap(layout);
  return Number.isFinite(gap) && gap > MIN_COMPOSER_INDEX_GAP;
}
