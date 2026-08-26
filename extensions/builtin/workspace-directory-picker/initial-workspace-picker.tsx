"use client";

import { useAuiState } from "@assistant-ui/react";
import { FolderOpenIcon, LoaderCircleIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { ComposerSlotContext } from "@/platform/extensions/authoring";
import { PiApiError, pickPiHostDirectory } from "@/runtime/pi/client/transport/api";
import type { PiWorkspaceSummary } from "@/runtime/pi/contracts";
import {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
} from "@/services/workspace-selection-service";

import {
  RemoteDirectoryPickerDialog,
  shouldUseNativeDirectoryPicker,
} from "./remote-directory-picker-dialog";
import { ProjectTrustDialog } from "./project-trust-dialog";
import { useWorkspaceDirectoryAdmission } from "./use-workspace-directory-admission";

export function InitialWorkspacePicker(_context: ComposerSlotContext) {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [error, setError] = useState(false);
  const isNewThread = useAuiState(
    (state) => state.threads.mainThreadId === state.threads.newThreadId,
  );
  const { draftWorkspace } = useWorkspaceSelection();
  const { beginNewThreadWithCreatedWorkspace } = useWorkspaceCapabilities();
  const selectWorkspace = useCallback(
    (workspace: PiWorkspaceSummary) => beginNewThreadWithCreatedWorkspace(workspace),
    [beginNewThreadWithCreatedWorkspace],
  );
  const admission = useWorkspaceDirectoryAdmission(selectWorkspace);
  const needsWorkspace = isNewThread && !draftWorkspace;

  const pickDirectory = async () => {
    if (picking) return;
    if (!shouldUseNativeDirectoryPicker()) {
      setError(false);
      setRemotePickerOpen(true);
      return;
    }
    setPicking(true);
    setError(false);
    try {
      const path = await pickPiHostDirectory();
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

  if (!needsWorkspace) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        size="lg"
        disabled={picking}
        aria-describedby={error ? "initial-workspace-picker-error" : undefined}
        onClick={() => void pickDirectory()}
        className="min-w-44 rounded-xl px-5 [@media(pointer:coarse)]:min-h-[var(--control-hit-touch)]"
      >
        {picking ? (
          <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
        ) : (
          <FolderOpenIcon aria-hidden="true" />
        )}
        {t(
          picking
            ? "extensions.workspaceDirectory.selecting"
            : "extensions.workspaceDirectory.selectTitle",
        )}
      </Button>
      {error ? (
        <p id="initial-workspace-picker-error" role="alert" className="text-destructive text-sm">
          {t("extensions.workspaceDirectory.selectError")}
        </p>
      ) : null}
      <RemoteDirectoryPickerDialog
        open={remotePickerOpen}
        onOpenChange={setRemotePickerOpen}
        onSelectPath={async (path) => {
          try {
            setError(false);
            await admission.selectPath(path);
          } catch (cause) {
            setError(true);
            throw cause;
          }
        }}
      />
      <ProjectTrustDialog
        open={admission.pendingPath !== undefined}
        path={admission.pendingPath ?? ""}
        saving={admission.savingDecision}
        error={admission.dialogError}
        onCancel={admission.cancelTrust}
        onDecision={admission.decideTrust}
      />
    </div>
  );
}
