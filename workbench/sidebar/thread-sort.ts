import { moveSidebarItemId, type SidebarDropPosition } from "./sidebar-reorder";

export type ThreadSortMode = "priority" | "recent" | "manual";
export type ThreadAutomaticSortMode = Exclude<ThreadSortMode, "manual">;
export type ThreadDropPosition = SidebarDropPosition;

interface SortableThread {
  id: string;
  isRunning?: boolean;
  lastMessageAt?: Date;
}

function lastMessageTime(thread: SortableThread | undefined): number {
  const timestamp = thread?.lastMessageAt?.getTime();
  return timestamp !== undefined && Number.isFinite(timestamp) ? timestamp : 0;
}

export function resolveManualThreadOrder(
  threadIds: readonly string[],
  storedOrder: readonly string[],
): readonly string[] {
  const availableIds = new Set(threadIds);
  const seenIds = new Set<string>();
  const resolved: string[] = [];

  for (const threadId of storedOrder) {
    if (!availableIds.has(threadId) || seenIds.has(threadId)) continue;
    seenIds.add(threadId);
    resolved.push(threadId);
  }

  for (const threadId of threadIds) {
    if (seenIds.has(threadId)) continue;
    seenIds.add(threadId);
    resolved.push(threadId);
  }

  return resolved;
}

export function moveThreadId(
  threadIds: readonly string[],
  sourceId: string,
  targetId: string,
  position: ThreadDropPosition,
): readonly string[] {
  return moveSidebarItemId(threadIds, sourceId, targetId, position);
}

export function sortThreadIds({
  threadIds,
  threadItems,
  mode,
  activeThreadId,
}: {
  threadIds: readonly string[];
  threadItems: readonly SortableThread[];
  mode: ThreadSortMode;
  activeThreadId?: string;
}): readonly string[] {
  if (mode === "manual") return threadIds;

  const itemsById = new Map(threadItems.map((thread) => [thread.id, thread]));
  const originalOrder = new Map(threadIds.map((threadId, index) => [threadId, index]));

  return [...threadIds].sort((leftId, rightId) => {
    const left = itemsById.get(leftId);
    const right = itemsById.get(rightId);

    if (mode === "priority") {
      const runningDifference =
        Number(right?.isRunning === true) - Number(left?.isRunning === true);
      if (runningDifference !== 0) return runningDifference;

      const activeDifference =
        Number(rightId === activeThreadId) - Number(leftId === activeThreadId);
      if (activeDifference !== 0) return activeDifference;
    }

    const recencyDifference = lastMessageTime(right) - lastMessageTime(left);
    if (recencyDifference !== 0) return recencyDifference;

    return (originalOrder.get(leftId) ?? 0) - (originalOrder.get(rightId) ?? 0);
  });
}

export function resolveThreadOrder({
  threadIds,
  threadItems,
  mode,
  activeThreadId,
  storedManualOrder,
  storedManualOrderRevision,
  sortRevision,
}: {
  threadIds: readonly string[];
  threadItems: readonly SortableThread[];
  mode: ThreadSortMode;
  activeThreadId?: string;
  storedManualOrder: readonly string[];
  storedManualOrderRevision?: number;
  sortRevision: number;
}): readonly string[] {
  if (mode === "manual" || storedManualOrderRevision === sortRevision) {
    return resolveManualThreadOrder(threadIds, storedManualOrder);
  }

  return sortThreadIds({ threadIds, threadItems, mode, activeThreadId });
}
