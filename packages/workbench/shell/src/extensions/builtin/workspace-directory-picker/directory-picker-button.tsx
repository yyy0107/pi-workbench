"use client";

import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@workbench/shell/ui";
import { useAgentRuntime } from "@workbench/agent-runtime-client";
import { useI18n } from "@workbench/shell/i18n";
import { cn } from "@workbench/shell/utils";
import {
  useWorkspaceCapabilities,
  type WorkbenchWorkspaceSummary,
} from "@workbench/agent-runtime-client/workspaces";
import { WorkbenchAgentCapabilityError } from "@workbench/agent-runtime-client";
import {
  type WorkbenchRuntimeHostCapability,
  type WorkbenchWorkspaceCapability,
} from "@workbench/agent-runtime-client";
import {
  useWorkbenchRuntimeHostCapability,
  useWorkbenchWorkspaceCapability,
} from "@workbench/agent-runtime-client/context";
import { useWorkbenchNavigation } from "@workbench/shell/navigation";

import { useRuntimeConnection } from "@workbench/shell/runtime-connection";
import { shouldUseNativeDirectoryPicker } from "./directory-picker-capability";
import { RemoteDirectoryPickerDialog } from "./remote-directory-picker-dialog";
import { ProjectTrustDialog } from "@workbench/shell/ui";
import { useWorkspaceDirectoryAdmission } from "./use-workspace-directory-admission";
import { activateCreatedWorkspace } from "./workspace-activation";
import { workspaceProjectTrustDialogCopy } from "./project-trust-dialog-copy";

export function DirectoryPickerButton() {
  const hostClient = useWorkbenchRuntimeHostCapability();
  const workspaceClient = useWorkbenchWorkspaceCapability();
  return hostClient && workspaceClient ? (
    <DirectoryPickerButtonContent hostClient={hostClient} workspaceClient={workspaceClient} />
  ) : null;
}

function DirectoryPickerButtonContent({
  hostClient,
  workspaceClient,
}: {
  hostClient: WorkbenchRuntimeHostCapability;
  workspaceClient: WorkbenchWorkspaceCapability;
}) {
  const { t } = useI18n();
  const trustDialogCopy = workspaceProjectTrustDialogCopy(t);
  const runtimeConnection = useRuntimeConnection();
  const runtime = useAgentRuntime();
  const navigation = useWorkbenchNavigation();
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
        navigateHome: navigation.openHome,
      });
    },
    [beginNewThreadWithCreatedWorkspace, navigation, runtime],
  );
  const admission = useWorkspaceDirectoryAdmission(activateDirectory, hostClient, workspaceClient);

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
      if (cause instanceof WorkbenchAgentCapabilityError && cause.code === "unavailable") {
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
        hostClient={hostClient}
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
