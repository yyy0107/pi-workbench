"use client";

import { useAuiState } from "@assistant-ui/react";
import { FolderIcon, LoaderCircleIcon, ShieldCheckIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ComposerDrawerSlotContext } from "@/platform/extensions";
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

export function WorkspaceDirectorySummary(_context: ComposerDrawerSlotContext) {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [error, setError] = useState(false);
  const isNewThread = useAuiState(
    (state) => state.threads.mainThreadId === state.threads.newThreadId,
  );
  const { activeWorkspace, draftWorkspace } = useWorkspaceSelection();
  const { beginNewThreadWithCreatedWorkspace } = useWorkspaceCapabilities();
  const selectedDirectory = isNewThread ? draftWorkspace : activeWorkspace;

  const selectWorkspace = useCallback(
    (workspace: PiWorkspaceSummary) => {
      beginNewThreadWithCreatedWorkspace(workspace);
    },
    [beginNewThreadWithCreatedWorkspace],
  );
  const admission = useWorkspaceDirectoryAdmission(selectWorkspace);

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

  return (
    <>
      <div className="flex h-6 min-w-0 items-center gap-2 text-[11px] leading-none">
        <button
          type="button"
          disabled={!isNewThread || picking}
          aria-label={t("extensions.workspaceDirectory.selectTitle")}
          title={
            error
              ? t("extensions.workspaceDirectory.selectError")
              : (selectedDirectory?.cwd ?? t("extensions.workspaceDirectory.selectTitle"))
          }
          onClick={() => void pickDirectory()}
          className={cn(
            "group-data-[selected=true]/composer:border-input group-data-[selected=true]/composer:bg-muted group-data-[selected=true]/composer:text-foreground inline-flex h-6 min-w-0 items-center gap-1 rounded-md border border-transparent bg-transparent px-2 font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none",
            error && "text-destructive",
          )}
        >
          {picking ? (
            <LoaderCircleIcon aria-hidden="true" className="size-3 shrink-0 animate-spin" />
          ) : (
            <FolderIcon aria-hidden="true" className="size-3 shrink-0" />
          )}
          <span className="max-w-44 truncate">
            {picking
              ? t("extensions.workspaceDirectory.selecting")
              : error
                ? t("extensions.workspaceDirectory.selectError")
                : (selectedDirectory?.name ?? t("extensions.workspaceDirectory.defaultName"))}
          </span>
        </button>
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 text-orange-600 dark:text-orange-400">
          <ShieldCheckIcon aria-hidden="true" className="size-3" />
          {t("extensions.workspaceDirectory.localPi")}
        </span>
      </div>
      <RemoteDirectoryPickerDialog
        open={remotePickerOpen}
        onOpenChange={setRemotePickerOpen}
        onSelectPath={admission.selectPath}
      />
      <ProjectTrustDialog
        open={admission.pendingPath !== undefined}
        path={admission.pendingPath ?? ""}
        saving={admission.savingDecision}
        error={admission.dialogError}
        onCancel={admission.cancelTrust}
        onDecision={admission.decideTrust}
      />
    </>
  );
}
