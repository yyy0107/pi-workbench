"use client";

import { useCallback, useState } from "react";

import type {
  WorkbenchRuntimeHostCapability,
  WorkbenchWorkspaceCapability,
} from "@workbench/agent-runtime-client";
import type { WorkbenchWorkspaceSummary } from "@workbench/agent-runtime-client/workspaces";
import type { ProjectTrustDialogError } from "@workbench/shell/ui";

import { admitTrustedWorkspace } from "./workspace-admission";

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
      const pathAwaitingConfirmation = await admitTrustedWorkspace(trust, (canonicalPath) =>
        selectWorkspace(canonicalPath, workspace),
      );
      setPendingSelection(
        pathAwaitingConfirmation ? { path: pathAwaitingConfirmation, workspace } : undefined,
      );
    },
    [selectWorkspace, hostClient],
  );

  const confirmTrust = useCallback(async () => {
    if (!pendingPath || savingDecision) return;
    setSavingDecision("trust");
    setDialogError(undefined);
    try {
      await hostClient.updateProjectTrust(pendingPath, true);
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
  }, [selectWorkspace, hostClient, pendingPath, pendingSelection, savingDecision]);

  const declineTrust = useCallback(async () => {
    if (!pendingPath || savingDecision) return;
    setSavingDecision("decline");
    setDialogError(undefined);
    try {
      await hostClient.updateProjectTrust(pendingPath, false);
      setPendingSelection(undefined);
    } catch {
      setDialogError("save");
    } finally {
      setSavingDecision(undefined);
    }
  }, [hostClient, pendingPath, savingDecision]);

  const cancelTrust = useCallback(() => {
    if (savingDecision) return;
    setPendingSelection(undefined);
    setDialogError(undefined);
  }, [savingDecision]);

  return {
    cancelTrust,
    confirmTrust,
    declineTrust,
    dialogError,
    pendingPath,
    savingDecision,
    selectPath,
  };
}
