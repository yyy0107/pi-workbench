"use client";

import { useLayoutEffect } from "react";

import { useCurrentSession } from "@workbench/agent-runtime-client";
import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";

import type { PiSessionManager } from "../runtime/manager";

export function PiDraftWorkspaceTracker({ manager }: { manager: PiSessionManager }) {
  const current = useCurrentSession();
  const newThreadId = current.isNewThread ? current.sessionId : undefined;
  const { draftWorkspace } = useWorkspaceSelection();
  const draftWorkspaceId = draftWorkspace?.id;
  const draftWorkspaceName = draftWorkspace?.name;
  const draftWorkspaceRootPath = draftWorkspace?.rootPath;
  const draftWorkspacePinned = draftWorkspace?.pinned;

  useLayoutEffect(() => {
    if (!newThreadId) return;
    const workspace =
      draftWorkspaceId === undefined ||
      draftWorkspaceName === undefined ||
      draftWorkspaceRootPath === undefined
        ? undefined
        : {
            id: draftWorkspaceId,
            name: draftWorkspaceName,
            cwd: draftWorkspaceRootPath,
            ...(draftWorkspacePinned === undefined ? {} : { pinned: draftWorkspacePinned }),
          };
    // Changing project selection restores that project's draft instead of moving the current one.
    const localId = manager.createDraft({ workspaceId: draftWorkspaceId });
    manager.setDraftWorkspace(localId, workspace);
  }, [
    draftWorkspaceRootPath,
    draftWorkspaceId,
    draftWorkspaceName,
    draftWorkspacePinned,
    manager,
    newThreadId,
  ]);

  return null;
}
