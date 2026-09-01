export function workspaceTabId(idPrefix: string, surfaceId: string): string {
  return `${idPrefix}-${encodeURIComponent(surfaceId)}`;
}

export function workspaceTabPanelId(idPrefix: string, surfaceId: string): string {
  return `${idPrefix}-${encodeURIComponent(surfaceId)}`;
}

export function nextWorkspaceTabIndex(
  key: string,
  currentIndex: number,
  tabCount: number,
  direction: "ltr" | "rtl",
): number | undefined {
  if (tabCount <= 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;

  const forward = key === "ArrowRight";
  const delta = forward === (direction === "ltr") ? 1 : -1;
  return (currentIndex + delta + tabCount) % tabCount;
}
