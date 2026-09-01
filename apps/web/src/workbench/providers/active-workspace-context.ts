import {
  createActiveWorkspaceContext,
  createMainViewWorkspaceContext,
  type ActiveWorkspaceContextInput,
} from "@workbench/shell/application";

const WEB_APPLICATION_ID = "pi-workbench";

export type { ActiveWorkspaceContextInput };

export function activeWorkspaceContext(input: ActiveWorkspaceContextInput) {
  return createActiveWorkspaceContext(WEB_APPLICATION_ID, input);
}

export function mainViewWorkspaceContext(kind: string) {
  return createMainViewWorkspaceContext(WEB_APPLICATION_ID, kind);
}
