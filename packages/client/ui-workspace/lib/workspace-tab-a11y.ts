export function workspaceTabId(idPrefix: string, surfaceId: string): string {
  return `${idPrefix}-${encodeURIComponent(surfaceId)}`;
}

export function workspaceTabPanelId(idPrefix: string, surfaceId: string): string {
  return `${idPrefix}-${encodeURIComponent(surfaceId)}`;
}
