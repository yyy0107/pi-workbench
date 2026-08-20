export interface PiThreadListStructureItem {
  readonly remoteId: string;
  readonly status: "regular" | "archived";
}

export interface AssistantThreadListStructureItem {
  readonly id: string;
  readonly remoteId?: string;
  readonly externalId?: string;
  readonly status: "new" | "regular" | "archived" | "deleted";
}

export interface AssistantThreadListStructure {
  readonly threadIds: readonly string[];
  readonly archivedThreadIds: readonly string[];
  readonly threadItems: readonly AssistantThreadListStructureItem[];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function assistantRemoteIds(
  ids: readonly string[],
  items: readonly AssistantThreadListStructureItem[],
): string[] {
  return ids.flatMap((id) => {
    const item = items.find(
      (candidate) =>
        candidate.id === id || candidate.remoteId === id || candidate.externalId === id,
    );
    if (!item) return id.startsWith("__LOCALID_") ? [] : [id];

    const remoteId = item.remoteId ?? item.externalId;
    if (remoteId) return [remoteId];
    return item.status === "new" || item.id.startsWith("__LOCALID_") ? [] : [item.id];
  });
}

/**
 * Compares only list structure. Titles, timestamps, running state, and other custom metadata are
 * projected directly from PiSessionManager and must not force assistant-ui to rebuild the list.
 */
export function piThreadListStructureMatches(
  managedItems: readonly PiThreadListStructureItem[],
  assistant: AssistantThreadListStructure,
): boolean {
  const managedRegular = managedItems
    .filter((item) => item.status === "regular")
    .map((item) => item.remoteId);
  const managedArchived = managedItems
    .filter((item) => item.status === "archived")
    .map((item) => item.remoteId);

  return (
    sameIds(managedRegular, assistantRemoteIds(assistant.threadIds, assistant.threadItems)) &&
    sameIds(managedArchived, assistantRemoteIds(assistant.archivedThreadIds, assistant.threadItems))
  );
}
