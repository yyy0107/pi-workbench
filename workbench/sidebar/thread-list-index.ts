export interface IndexedThreadListItem {
  readonly threadId: string;
  readonly index: number;
}

/**
 * Resolve the desired visible order to assistant-ui's canonical thread indexes.
 * Rendering only these indexes avoids walking the complete thread list once per workspace.
 */
export function indexVisibleThreads(
  threadIds: readonly string[],
  visibleThreadIds: readonly string[],
): readonly IndexedThreadListItem[] {
  const indexById = new Map(threadIds.map((threadId, index) => [threadId, index]));
  return visibleThreadIds.flatMap((threadId) => {
    const index = indexById.get(threadId);
    return index === undefined ? [] : [{ threadId, index }];
  });
}
