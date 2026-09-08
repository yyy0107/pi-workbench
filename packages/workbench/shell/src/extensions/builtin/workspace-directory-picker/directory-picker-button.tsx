"use client";

import { PlusIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@workbench/shell/ui";
import { useAgentRuntime } from "@workbench/agent-runtime-client";
import { useI18n } from "@workbench/shell/i18n";
import {
  useWorkspaceCapabilities,
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
import { useWorkbenchNavigation } from "@workbench/shell/navigation";

import { WorkspaceDirectoryPickerDialog } from "./workspace-directory-picker-dialog";
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
  const runtime = useAgentRuntime();
  const navigation = useWorkbenchNavigation();
  const [pickerOpen, setPickerOpen] = useState(false);
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

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("extensions.workspaceDirectory.add")}
        title={t("extensions.workspaceDirectory.add")}
        onClick={() => setPickerOpen(true)}
        className="text-muted-foreground hover:text-foreground"
      >
        <PlusIcon aria-hidden="true" />
      </Button>
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
