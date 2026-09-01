"use client";

import { useAuiState } from "@assistant-ui/react";
import { useEffect, useLayoutEffect } from "react";

import { useWorkspaceSelection } from "@workbench/agent-runtime-client/workspaces";

import type { PiSessionManager } from "../runtime/manager";

export function ActivePiThreadTracker({ manager }: { manager: PiSessionManager }) {
  const mainThreadId = useAuiState((state) => state.threads.mainThreadId);
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const mainThread = threadItems.find((thread) => thread.id === mainThreadId);

  useEffect(() => {
    manager.setActive(mainThreadId, mainThread?.remoteId);
  }, [mainThread?.remoteId, mainThreadId, manager]);

  return null;
}

export function PiDraftWorkspaceTracker({ manager }: { manager: PiSessionManager }) {
  const newThreadId = useAuiState((state) => state.threads.newThreadId);
  const { draftWorkspace } = useWorkspaceSelection();
  const draftWorkspaceId = draftWorkspace?.id;
  const draftWorkspaceName = draftWorkspace?.name;
  const draftWorkspaceRootPath = draftWorkspace?.rootPath;
  const draftWorkspacePinned = draftWorkspace?.pinned;

  useLayoutEffect(() => {
    if (!newThreadId) return;
    return () => manager.setDraftWorkspace(newThreadId, undefined);
  }, [manager, newThreadId]);

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
    manager.setDraftWorkspace(newThreadId, workspace);
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
