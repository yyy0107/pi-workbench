export function withoutWorkspaceIdentity<T extends { workspaceId?: string; relativePath: string }>(
  value: T,
) {
  const { workspaceId: _workspaceId, relativePath: _relativePath, ...file } = value;
  return file;
}
