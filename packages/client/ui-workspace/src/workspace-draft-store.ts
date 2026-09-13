"use client";

import { useRightWorkspaceEnvironment } from "./right-workspace-context";

export function useWorkspaceDraftStore() {
  return useRightWorkspaceEnvironment().draftStore;
}
