"use client";

import { useCallback, useState } from "react";

import {
  createPiWorkspace,
  describePiProjectTrust,
  updatePiProjectTrust,
} from "@/workbench/runtime-contributions/pi/client/workspace";
import type { WorkbenchWorkspaceSummary } from "@workbench/agent-runtime-client/workspaces";
import type { ProjectTrustDialogError } from "@/components/ui/project-trust-dialog";

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
  const [pendingPath, setPendingPath] = useState<string>();
  const [savingDecision, setSavingDecision] = useState<"trust" | "decline">();
  const [dialogError, setDialogError] = useState<ProjectTrustDialogError>();

  const createAndSelect = useCallback(
    async (path: string) => {
      const { workspace } = await createPiWorkspace(path);
      await onSelect(workspaceSummary(workspace));
    },
    [onSelect],
  );

  const selectPath = useCallback(
    async (path: string) => {
      setDialogError(undefined);
      const trust = await describePiProjectTrust({ path });
      const pathAwaitingConfirmation = await admitTrustedWorkspace(trust, createAndSelect);
      setPendingPath(pathAwaitingConfirmation);
    },
    [createAndSelect],
  );

  const confirmTrust = useCallback(async () => {
    if (!pendingPath || savingDecision) return;
    setSavingDecision("trust");
    setDialogError(undefined);
    try {
      await updatePiProjectTrust({ path: pendingPath, trusted: true });
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
  }, [createAndSelect, pendingPath, savingDecision]);

  const declineTrust = useCallback(async () => {
    if (!pendingPath || savingDecision) return;
    setSavingDecision("decline");
    setDialogError(undefined);
    try {
      await updatePiProjectTrust({ path: pendingPath, trusted: false });
      setPendingPath(undefined);
    } catch {
      setDialogError("save");
    } finally {
      setSavingDecision(undefined);
    }
  }, [pendingPath, savingDecision]);

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
