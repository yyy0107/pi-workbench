"use client";

import { useAuiState } from "@assistant-ui/react";
import { FolderIcon, LoaderCircleIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ComposerDrawerSlotContext } from "@/platform/extensions";
import { PiApiError, pickPiWorkspace } from "@/runtime/pi/client/transport/api";
import type { PiWorkspaceSummary } from "@/runtime/pi/contracts";
import {
  useWorkspaceCapabilities,
  useWorkspaceSelection,
} from "@/services/workspace-selection-service";

import {
  RemoteDirectoryPickerDialog,
  shouldUseNativeDirectoryPicker,
} from "./remote-directory-picker-dialog";

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

  const selectWorkspace = (workspace: PiWorkspaceSummary) => {
    beginNewThreadWithCreatedWorkspace(workspace);
  };

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
      const workspace = await pickPiWorkspace();
      if (workspace) {
        selectWorkspace(workspace);
      }
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
      <div className="flex min-w-0 items-center gap-2 text-[11px]">
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
            "group-data-[selected=true]/composer:border-blue-200 group-data-[selected=true]/composer:bg-blue-50 group-data-[selected=true]/composer:text-blue-600 inline-flex h-6 min-w-0 items-center gap-1 rounded-md border border-transparent bg-transparent px-2 font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none dark:group-data-[selected=true]/composer:border-blue-800 dark:group-data-[selected=true]/composer:bg-blue-950/50 dark:group-data-[selected=true]/composer:text-blue-400",
            error && "text-destructive",
          )}
        >
          {picking ? (
            <LoaderCircleIcon className="size-3 shrink-0 animate-spin" />
          ) : (
            <FolderIcon className="size-3 shrink-0" />
          )}
          <span className="max-w-44 truncate">
            {picking
              ? t("extensions.workspaceDirectory.selecting")
              : error
                ? t("extensions.workspaceDirectory.selectError")
                : (selectedDirectory?.name ?? t("extensions.workspaceDirectory.defaultName"))}
          </span>
        </button>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-orange-600 dark:text-orange-400">
          <ShieldCheckIcon className="size-3" />
          {t("extensions.workspaceDirectory.localPi")}
        </span>
      </div>
      <RemoteDirectoryPickerDialog
        open={remotePickerOpen}
        onOpenChange={setRemotePickerOpen}
        onSelect={selectWorkspace}
      />
    </>
  );
}
