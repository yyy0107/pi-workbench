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

/** Resolves a physical pointer position to the logical insertion edge. */
export function workspaceTabDropPosition(
  pointerX: number,
  tabLeft: number,
  tabWidth: number,
  direction: "ltr" | "rtl",
): "before" | "after" {
  const beforeMidpoint = pointerX < tabLeft + tabWidth / 2;
  if (direction === "rtl") return beforeMidpoint ? "after" : "before";
  return beforeMidpoint ? "before" : "after";
}
