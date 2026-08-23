export function workspaceTabScrollDelta(
  viewportLeft: number,
  viewportRight: number,
  tabLeft: number,
  tabRight: number,
): number {
  if (tabLeft < viewportLeft) return tabLeft - viewportLeft;
  if (tabRight > viewportRight) return tabRight - viewportRight;
  return 0;
}
