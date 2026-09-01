"use client";

import { useAuiState } from "@assistant-ui/react";
import { CloudIcon, FolderPlusIcon, LoaderCircleIcon, MessageCircleIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { DropdownMenuItem, DropdownMenuSeparator } from "@workbench/shell/ui";
import { WorkspaceSelector } from "@workbench/shell/ui";
import { usePiI18n } from "../../i18n";
import type { ComposerSlotContext } from "@workbench/extension-sdk";
import {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
  type WorkbenchWorkspaceSummary,
} from "@workbench/agent-runtime-client/workspaces";
import { PiApiError } from "@workbench/agent-runtime-pi-client/errors";
import { usePiHostClient } from "@workbench/agent-runtime-pi-client/host";

import { usePiRuntimeConnection } from "../../public/runtime-connection-context";
import { shouldUseNativeDirectoryPicker } from "./directory-picker-capability";
import { RemoteDirectoryPickerDialog } from "./remote-directory-picker-dialog";
import { ProjectTrustDialog } from "@workbench/shell/ui";
import { useWorkspaceDirectoryAdmission } from "./use-workspace-directory-admission";
import { workspaceProjectTrustDialogCopy } from "../project-trust-dialog-copy";

export function WorkspaceDirectorySummary(_context: ComposerSlotContext) {
  const { t } = usePiI18n();
  const trustDialogCopy = workspaceProjectTrustDialogCopy(t);
  const hostClient = usePiHostClient();
  const runtimeConnection = usePiRuntimeConnection();
  const [picking, setPicking] = useState(false);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [error, setError] = useState(false);
  const isNewThread = useAuiState(
    (state) => state.threads.mainThreadId === state.threads.newThreadId,
  );
  const { activeWorkspace, draftWorkspace, workspaces } = useWorkspaceSelection();
  const { beginNewThread, beginNewThreadWithCreatedWorkspace, destroyNewThread } =
    useWorkspaceCapabilities();
  const selectedDirectory = isNewThread ? draftWorkspace : activeWorkspace;
  const canClearWorkspace = isNewThread && selectedDirectory !== undefined && !picking;

  const selectWorkspace = useCallback(
    (workspace: WorkbenchWorkspaceSummary) => {
      beginNewThreadWithCreatedWorkspace(workspace);
    },
    [beginNewThreadWithCreatedWorkspace],
  );
  const admission = useWorkspaceDirectoryAdmission(selectWorkspace);

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
      <WorkspaceSelector
        canClear={canClearWorkspace}
        disabled={!isNewThread}
        error={error}
        labels={{
          select: t("extensions.workspaceDirectory.selectTitle"),
          clear: t("extensions.workspaceDirectory.clearWorkspace"),
          selecting: t("extensions.workspaceDirectory.selecting"),
          selectError: t("extensions.workspaceDirectory.selectError"),
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
          if (isNewThread) beginNewThread(workspaceId);
        }}
        footer={
          <div>
            <DropdownMenuSeparator className="m-0" />
            <div className="p-1">
              <DropdownMenuItem
                disabled={picking}
                className="min-h-9 gap-2.5 rounded-lg px-2.5 text-sm"
                onClick={() => void pickDirectory()}
              >
                {picking ? (
                  <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <FolderPlusIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                )}
                {t("extensions.workspaceDirectory.openFolder")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-9 gap-2.5 rounded-lg px-2.5 text-sm"
                onClick={() => {
                  setError(false);
                  setRemotePickerOpen(true);
                }}
              >
                <CloudIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                {t("extensions.workspaceDirectory.remoteConnection")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled
                title={t("extensions.workspaceDirectory.noProjectUnavailable")}
                className="min-h-9 gap-2.5 rounded-lg px-2.5 text-sm"
              >
                <MessageCircleIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                {t("extensions.workspaceDirectory.noProject")}
              </DropdownMenuItem>
            </div>
          </div>
        }
      />
      <RemoteDirectoryPickerDialog
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
