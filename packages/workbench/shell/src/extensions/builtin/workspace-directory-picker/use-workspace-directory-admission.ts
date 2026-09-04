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
  const [pendingPath, setPendingPath] = useState<string>();
  const [savingDecision, setSavingDecision] = useState<"trust" | "decline">();
  const [dialogError, setDialogError] = useState<ProjectTrustDialogError>();

  const createAndSelect = useCallback(
    async (path: string) => {
      const { workspace } = await workspaceClient.createWorkspace(path);
      await onSelect(workspace);
    },
    [onSelect, workspaceClient],
  );

  const selectPath = useCallback(
    async (path: string) => {
      setDialogError(undefined);
      const trust = await hostClient.describeProjectTrust(path);
      const pathAwaitingConfirmation = await admitTrustedWorkspace(trust, createAndSelect);
      setPendingPath(pathAwaitingConfirmation);
    },
    [createAndSelect, hostClient],
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
      await createAndSelect(pendingPath);
      setPendingPath(undefined);
    } catch {
      setDialogError("select");
    } finally {
      setSavingDecision(undefined);
    }
  }, [createAndSelect, hostClient, pendingPath, savingDecision]);

  const declineTrust = useCallback(async () => {
    if (!pendingPath || savingDecision) return;
    setSavingDecision("decline");
    setDialogError(undefined);
    try {
      await hostClient.updateProjectTrust(pendingPath, false);
      setPendingPath(undefined);
    } catch {
      setDialogError("save");
    } finally {
      setSavingDecision(undefined);
    }
  }, [hostClient, pendingPath, savingDecision]);

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
