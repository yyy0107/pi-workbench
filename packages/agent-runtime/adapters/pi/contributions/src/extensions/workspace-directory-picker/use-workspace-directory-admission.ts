"use client";

import { useCallback, useState } from "react";

import { usePiWorkspaceClient } from "@workbench/agent-runtime-pi-client/workspace";
import type { WorkbenchWorkspaceSummary } from "@workbench/agent-runtime-client/workspaces";
import type { ProjectTrustDialogError } from "@workbench/shell/ui";

import { admitTrustedWorkspace } from "./workspace-admission";

function workspaceSummary(workspace: {
  workspaceId: string;
  title: string;
  path: string;
}): WorkbenchWorkspaceSummary {
  return { id: workspace.workspaceId, name: workspace.title, rootPath: workspace.path };
}

export function useWorkspaceDirectoryAdmission(
  onSelect: (workspace: WorkbenchWorkspaceSummary) => void | Promise<void>,
) {
  const workspaceClient = usePiWorkspaceClient();
  const [pendingPath, setPendingPath] = useState<string>();
  const [savingDecision, setSavingDecision] = useState<"trust" | "decline">();
  const [dialogError, setDialogError] = useState<ProjectTrustDialogError>();

  const createAndSelect = useCallback(
    async (path: string) => {
      const { workspace } = await workspaceClient.createWorkspace(path);
      await onSelect(workspaceSummary(workspace));
    },
    [onSelect, workspaceClient],
  );

  const selectPath = useCallback(
    async (path: string) => {
      setDialogError(undefined);
      const trust = await workspaceClient.describeProjectTrust({ path });
      const pathAwaitingConfirmation = await admitTrustedWorkspace(trust, createAndSelect);
      setPendingPath(pathAwaitingConfirmation);
    },
    [createAndSelect, workspaceClient],
  );

  const confirmTrust = useCallback(async () => {
    if (!pendingPath || savingDecision) return;
    setSavingDecision("trust");
    setDialogError(undefined);
    try {
      await workspaceClient.updateProjectTrust({ path: pendingPath, trusted: true });
    } catch {
      setDialogError("save");
      setSavingDecision(undefined);
      return;
    }

    try {
      await createAndSelect(pendingPath);
      setPendingPath(undefined);
    } catch {
      setDialogError("select");
    } finally {
      setSavingDecision(undefined);
    }
  }, [createAndSelect, pendingPath, savingDecision, workspaceClient]);

  const declineTrust = useCallback(async () => {
    if (!pendingPath || savingDecision) return;
    setSavingDecision("decline");
    setDialogError(undefined);
    try {
      await workspaceClient.updateProjectTrust({ path: pendingPath, trusted: false });
      setPendingPath(undefined);
    } catch {
      setDialogError("save");
    } finally {
      setSavingDecision(undefined);
    }
  }, [pendingPath, savingDecision, workspaceClient]);

  const cancelTrust = useCallback(() => {
    if (savingDecision) return;
    setPendingPath(undefined);
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
