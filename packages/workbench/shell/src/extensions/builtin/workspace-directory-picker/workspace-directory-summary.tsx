"use client";

import { FolderPlusIcon, LoaderCircleIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@workbench/shell/ui";
import { WorkspaceSelector } from "@workbench/shell/ui";
import { useI18n } from "@workbench/shell/i18n";
import type { ComposerSlotContext } from "@workbench/extension-sdk";
import { useCurrentSession } from "@workbench/agent-runtime-client";
import {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
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

import { useRuntimeConnection } from "@workbench/shell/runtime-connection";
import { shouldUseNativeDirectoryPicker } from "./directory-picker-capability";
import { RemoteDirectoryPickerDialog } from "./remote-directory-picker-dialog";
import { ProjectTrustDialog } from "@workbench/shell/ui";
import { useWorkspaceDirectoryAdmission } from "./use-workspace-directory-admission";
import { workspaceProjectTrustDialogCopy } from "./project-trust-dialog-copy";

export function WorkspaceDirectorySummary(props: ComposerSlotContext) {
  const hostClient = useWorkbenchRuntimeHostCapability();
  const workspaceClient = useWorkbenchWorkspaceCapability();
  return hostClient && workspaceClient ? (
    <WorkspaceDirectorySummaryContent
      {...props}
      hostClient={hostClient}
      workspaceClient={workspaceClient}
    />
  ) : null;
}

function WorkspaceDirectorySummaryContent({
  submissionBlocked,
  hostClient,
  workspaceClient,
}: ComposerSlotContext & {
  hostClient: WorkbenchRuntimeHostCapability;
  workspaceClient: WorkbenchWorkspaceCapability;
}) {
  const { t } = useI18n();
  const trustDialogCopy = workspaceProjectTrustDialogCopy(t);
  const runtimeConnection = useRuntimeConnection();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [error, setError] = useState(false);
  const isNewThread = useCurrentSession().isNewThread;
  const { activeWorkspace, draftWorkspace, workspaces } = useWorkspaceSelection();
  const { beginNewThread, beginNewThreadWithCreatedWorkspace, destroyNewThread } =
    useWorkspaceCapabilities();
  const selectedDirectory = isNewThread ? draftWorkspace : activeWorkspace;
  const canClearWorkspace = isNewThread && selectedDirectory !== undefined && !picking;
  const workspaceRequired = submissionBlocked && selectedDirectory === undefined;

  const selectWorkspace = useCallback(
    (workspace: WorkbenchWorkspaceSummary) => {
      beginNewThreadWithCreatedWorkspace(workspace);
    },
    [beginNewThreadWithCreatedWorkspace],
  );
  const admission = useWorkspaceDirectoryAdmission(selectWorkspace, hostClient, workspaceClient);

  const pickDirectory = async () => {
    if (picking) return;
    setSelectorOpen(false);
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
      <WorkspaceSelector
        canClear={canClearWorkspace}
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        disabled={!isNewThread}
        error={error || workspaceRequired}
        labels={{
          select: t("extensions.workspaceDirectory.selectTitle"),
          clear: t("extensions.workspaceDirectory.clearWorkspace"),
          selecting: t("extensions.workspaceDirectory.selecting"),
          selectError: t(
            workspaceRequired
              ? "extensions.workspaceDirectory.required"
              : "extensions.workspaceDirectory.selectError",
          ),
          empty: t("extensions.workspaceDirectory.defaultName"),
          search: t("extensions.workspaceDirectory.searchLabel"),
          searchPlaceholder: t("extensions.workspaceDirectory.searchPlaceholder"),
          noSearchResults: t("extensions.workspaceDirectory.noSearchResults"),
        }}
        picking={picking}
        selectedWorkspace={selectedDirectory}
        workspaces={workspaces}
        onClear={() => {
          setError(false);
          destroyNewThread();
        }}
        onValueChange={(workspaceId) => {
          if (isNewThread) {
            setError(false);
            beginNewThread(workspaceId);
          }
        }}
        footer={
          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              disabled={picking}
              className="w-full justify-start gap-2.5 px-2.5 text-sm"
              onClick={() => void pickDirectory()}
            >
              {picking ? (
                <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <FolderPlusIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              )}
              {t("extensions.workspaceDirectory.openFolder")}
            </Button>
          </div>
        }
      />
      <RemoteDirectoryPickerDialog
        hostClient={hostClient}
        open={remotePickerOpen}
        onOpenChange={setRemotePickerOpen}
        onSelectPath={admission.selectPath}
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
