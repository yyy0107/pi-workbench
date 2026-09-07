"use client";

import { useCallback, useState } from "react";

import type {
  WorkbenchRuntimeHostCapability,
  WorkbenchWorkspaceCapability,
} from "@workbench/agent-runtime-client";
import type { WorkbenchWorkspaceSummary } from "@workbench/agent-runtime-client/workspaces";
import type { ProjectTrustDialogError } from "@workbench/shell/ui";

import { admitWorkspace } from "./workspace-admission";

export function useWorkspaceDirectoryAdmission(
  onSelect: (workspace: WorkbenchWorkspaceSummary) => void | Promise<void>,
  hostClient: WorkbenchRuntimeHostCapability,
  workspaceClient: WorkbenchWorkspaceCapability,
) {
  const [pendingSelection, setPendingSelection] = useState<{
    path: string;
    workspace?: WorkbenchWorkspaceSummary;
  }>();
  const pendingPath = pendingSelection?.path;
  const [savingDecision, setSavingDecision] = useState<"trust" | "decline">();
  const [dialogError, setDialogError] = useState<ProjectTrustDialogError>();

  const selectWorkspace = useCallback(
    async (path: string, existingWorkspace?: WorkbenchWorkspaceSummary) => {
      const workspace =
        existingWorkspace ?? (await workspaceClient.createWorkspace(path)).workspace;
      await onSelect(workspace);
    },
    [onSelect, workspaceClient],
  );

  const selectPath = useCallback(
    async (path: string, workspace?: WorkbenchWorkspaceSummary) => {
      setDialogError(undefined);
      const trust = await hostClient.describeProjectTrust(path);
      const pathAwaitingConfirmation = await admitWorkspace(trust, (canonicalPath) =>
        selectWorkspace(canonicalPath, workspace),
      );
      setPendingSelection(
        pathAwaitingConfirmation ? { path: pathAwaitingConfirmation, workspace } : undefined,
      );
    },
    [selectWorkspace, hostClient],
  );

  const saveDecision = useCallback(
    async (trusted: boolean) => {
      if (!pendingPath || savingDecision) return;
      setSavingDecision(trusted ? "trust" : "decline");
      setDialogError(undefined);
      try {
        await hostClient.updateProjectTrust(pendingPath, trusted);
      } catch {
        setDialogError("save");
        setSavingDecision(undefined);
        return;
      }

      try {
        await selectWorkspace(pendingPath, pendingSelection?.workspace);
        setPendingSelection(undefined);
      } catch {
        setDialogError("select");
      } finally {
        setSavingDecision(undefined);
      }
    },
    [selectWorkspace, hostClient, pendingPath, pendingSelection, savingDecision],
  );

  const cancelTrust = useCallback(() => {
    if (savingDecision) return;
    setPendingSelection(undefined);
    setDialogError(undefined);
  }, [savingDecision]);

  return {
    cancelTrust,
    confirmTrust: () => saveDecision(true),
    declineTrust: () => saveDecision(false),
    dialogError,
    pendingPath,
    savingDecision,
    selectPath,
  };
}
