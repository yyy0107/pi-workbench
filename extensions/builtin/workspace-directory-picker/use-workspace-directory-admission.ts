"use client";

import { useCallback, useState } from "react";

import {
  createPiWorkspace,
  describePiProjectTrust,
  updatePiProjectTrust,
} from "@/runtime/pi/client/transport/api";
import type { PiWorkspaceSummary } from "@/runtime/pi/contracts";

import type { ProjectTrustDialogError } from "./project-trust-dialog";

function workspaceSummary(workspace: {
  workspaceId: string;
  title: string;
  path: string;
}): PiWorkspaceSummary {
  return { id: workspace.workspaceId, name: workspace.title, cwd: workspace.path };
}

export function useWorkspaceDirectoryAdmission(
  onSelect: (workspace: PiWorkspaceSummary) => void | Promise<void>,
) {
  const [pendingPath, setPendingPath] = useState<string>();
  const [savingDecision, setSavingDecision] = useState(false);
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
      if (trust.promptRequired) {
        setPendingPath(trust.path);
        return;
      }
      await createAndSelect(trust.path);
    },
    [createAndSelect],
  );

  const decideTrust = useCallback(
    async (trusted: boolean) => {
      if (!pendingPath || savingDecision) return;
      setSavingDecision(true);
      setDialogError(undefined);
      try {
        await updatePiProjectTrust({ path: pendingPath, trusted });
      } catch {
        setDialogError("save");
        setSavingDecision(false);
        return;
      }

      try {
        await createAndSelect(pendingPath);
        setPendingPath(undefined);
      } catch {
        setDialogError("select");
      } finally {
        setSavingDecision(false);
      }
    },
    [createAndSelect, pendingPath, savingDecision],
  );

  const cancelTrust = useCallback(() => {
    if (savingDecision) return;
    setPendingPath(undefined);
    setDialogError(undefined);
  }, [savingDecision]);

  return {
    cancelTrust,
    decideTrust,
    dialogError,
    pendingPath,
    savingDecision,
    selectPath,
  };
}
