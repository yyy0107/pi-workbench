import { moveSidebarItemId, type SidebarDropPosition } from "./sidebar-reorder";

export type ThreadDropPosition = SidebarDropPosition;

function threadCreatedTime(createdAt: string | undefined): number {
  if (createdAt === undefined) return 0;
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortThreadIdsByCreation(
  threadIds: readonly string[],
  createdAtByThreadId: ReadonlyMap<string, string | undefined>,
): readonly string[] {
  const originalOrder = new Map(threadIds.map((threadId, index) => [threadId, index]));

  return [...threadIds].sort((leftId, rightId) => {
    const creationDifference =
      threadCreatedTime(createdAtByThreadId.get(rightId)) -
      threadCreatedTime(createdAtByThreadId.get(leftId));
    if (creationDifference !== 0) return creationDifference;
    return (originalOrder.get(leftId) ?? 0) - (originalOrder.get(rightId) ?? 0);
  });
}

export function resolveManualThreadOrder(
  threadIds: readonly string[],
  storedOrder: readonly string[],
): readonly string[] {
  const availableIds = new Set(threadIds);
  const seenIds = new Set<string>();
  const storedIds: string[] = [];

  for (const threadId of storedOrder) {
    if (!availableIds.has(threadId) || seenIds.has(threadId)) continue;
    seenIds.add(threadId);
    storedIds.push(threadId);
  }

  // Sessions created after the last drag are not in the persisted id list yet, so keep their
  // canonical creation order ahead of that older override.
  const newIds = threadIds.filter((threadId) => !seenIds.has(threadId));
  return [...newIds, ...storedIds];
}

export function resolveThreadOrder(
  threadIds: readonly string[],
  createdAtByThreadId: ReadonlyMap<string, string | undefined>,
  storedOrder: readonly string[],
): readonly string[] {
  return resolveManualThreadOrder(
    sortThreadIdsByCreation(threadIds, createdAtByThreadId),
    storedOrder,
  );
}

export function moveThreadId(
  threadIds: readonly string[],
  sourceId: string,
  targetId: string,
  position: ThreadDropPosition,
): readonly string[] {
  return moveSidebarItemId(threadIds, sourceId, targetId, position);
}
