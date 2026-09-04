"use client";

import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@workbench/shell/ui";
import { useAgentRuntime } from "@workbench/agent-runtime-client";
import { usePiI18n } from "../../i18n";
import { cn } from "@workbench/shell/utils";
import {
  useWorkspaceCapabilities,
  type WorkbenchWorkspaceSummary,
} from "@workbench/agent-runtime-client/workspaces";
import { PiApiError } from "@workbench/agent-runtime-pi-client/errors";
import { usePiHostClient } from "@workbench/agent-runtime-pi-client/host";
import { useNavigationService } from "@workbench/extension-host";

import { usePiRuntimeConnection } from "../../public/runtime-connection-context";
import { shouldUseNativeDirectoryPicker } from "./directory-picker-capability";
import { RemoteDirectoryPickerDialog } from "./remote-directory-picker-dialog";
import { ProjectTrustDialog } from "@workbench/shell/ui";
import { useWorkspaceDirectoryAdmission } from "./use-workspace-directory-admission";
import { activateCreatedWorkspace } from "./workspace-activation";
import { workspaceProjectTrustDialogCopy } from "../project-trust-dialog-copy";

export function DirectoryPickerButton() {
  const { t } = usePiI18n();
  const trustDialogCopy = workspaceProjectTrustDialogCopy(t);
  const hostClient = usePiHostClient();
  const runtimeConnection = usePiRuntimeConnection();
  const runtime = useAgentRuntime();
  const navigation = useNavigationService();
  const [picking, setPicking] = useState(false);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [error, setError] = useState(false);
  const { beginNewThreadWithCreatedWorkspace } = useWorkspaceCapabilities();

  const activateDirectory = useCallback(
    async (workspace: WorkbenchWorkspaceSummary) => {
      await activateCreatedWorkspace(workspace, {
        beginNewThreadWithCreatedWorkspace,
        createDraft: (workspaceId) => {
          runtime.createDraft({ workspaceId });
        },
        navigateHome: navigation.newThread,
      });
    },
    [beginNewThreadWithCreatedWorkspace, navigation, runtime],
  );
  const admission = useWorkspaceDirectoryAdmission(activateDirectory);

  const pickDirectory = async () => {
    if (picking) return;
    if (!shouldUseNativeDirectoryPicker(runtimeConnection)) {
      setError(false);
      setRemotePickerOpen(true);
      return;
    }
    setPicking(true);
    setError(false);
    try {
      const path = await hostClient.pickDirectory();
      if (path) await admission.selectPath(path);
    } catch (cause) {
      if (cause instanceof PiApiError && cause.code === "directory-picker-unavailable") {
        setRemotePickerOpen(true);
      } else {
        setError(true);
      }
    } finally {
      setPicking(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={picking}
        aria-label={t(
          picking ? "extensions.workspaceDirectory.selecting" : "extensions.workspaceDirectory.add",
        )}
        title={t(
          error ? "extensions.workspaceDirectory.selectError" : "extensions.workspaceDirectory.add",
        )}
        onClick={() => void pickDirectory()}
        className={cn(
          "text-muted-foreground hover:text-foreground focus-visible:border-transparent focus-visible:ring-0",
          error && "text-destructive hover:text-destructive",
        )}
      >
        {picking ? <LoaderCircleIcon className="animate-spin" /> : <PlusIcon />}
      </Button>
      <RemoteDirectoryPickerDialog
        open={remotePickerOpen}
        onOpenChange={setRemotePickerOpen}
        onSelectPath={async (path) => {
          try {
            await admission.selectPath(path);
          } catch (cause) {
            setError(true);
            throw cause;
          }
        }}
      />
      <ProjectTrustDialog
        copy={trustDialogCopy}
        open={admission.pendingPath !== undefined}
        path={admission.pendingPath ?? ""}
        savingDecision={admission.savingDecision}
        error={admission.dialogError}
        onCancel={admission.cancelTrust}
        onConfirm={admission.confirmTrust}
        onDecline={admission.declineTrust}
      />
    </>
  );
}
