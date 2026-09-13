export type SidebarDropPosition = "before" | "after";

export function moveSidebarItemId(
  itemIds: readonly string[],
  sourceId: string,
  targetId: string,
  position: SidebarDropPosition,
): readonly string[] {
  if (sourceId === targetId || !itemIds.includes(sourceId) || !itemIds.includes(targetId)) {
    return itemIds;
  }

  const reordered = itemIds.filter((itemId) => itemId !== sourceId);
  const targetIndex = reordered.indexOf(targetId);
  const insertionIndex = targetIndex + (position === "after" ? 1 : 0);
  reordered.splice(insertionIndex, 0, sourceId);
  return reordered;
}

export function sidebarItemIdAfterMove(
  itemIds: readonly string[],
  sourceId: string,
  targetId: string,
  position: SidebarDropPosition,
): string | undefined {
  const reordered = moveSidebarItemId(itemIds, sourceId, targetId, position);
  const sourceIndex = reordered.indexOf(sourceId);
  return sourceIndex < 0 ? undefined : reordered[sourceIndex + 1];
}
