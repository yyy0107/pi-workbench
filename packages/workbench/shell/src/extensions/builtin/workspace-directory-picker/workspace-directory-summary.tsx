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
import {
  type WorkbenchRuntimeHostCapability,
  type WorkbenchWorkspaceCapability,
} from "@workbench/agent-runtime-client";
import {
  useWorkbenchRuntimeHostCapability,
  useWorkbenchWorkspaceCapability,
} from "@workbench/agent-runtime-client/context";

import { WorkspaceDirectoryPickerDialog } from "./workspace-directory-picker-dialog";
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
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState(false);
  const isNewThread = useCurrentSession().isNewThread;
  const { activeWorkspace, draftWorkspace, workspaces } = useWorkspaceSelection();
  const { beginNewThreadWithCreatedWorkspace, destroyNewThread } = useWorkspaceCapabilities();
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
        onValueChange={async (workspaceId) => {
          const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
          if (!isNewThread || picking || !workspace) return;
          setSelectorOpen(false);
          setPicking(true);
          setError(false);
          try {
            await admission.selectPath(workspace.rootPath, workspace);
          } catch {
            setError(true);
          } finally {
            setPicking(false);
          }
        }}
        footer={
          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              disabled={picking}
              className="w-full justify-start gap-2.5 px-2.5 text-sm"
              onClick={() => {
                setSelectorOpen(false);
                setError(false);
                setPickerOpen(true);
              }}
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
      {pickerOpen ? (
        <WorkspaceDirectoryPickerDialog
          hostClient={hostClient}
          onClose={() => setPickerOpen(false)}
          onSelectPath={admission.selectPath}
        />
      ) : null}
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
