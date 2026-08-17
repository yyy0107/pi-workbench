"use client";

import { useAuiState } from "@assistant-ui/react";
import { FolderIcon, LoaderCircleIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ComposerDrawerSlotContext } from "@/platform/extensions";
import { pickPiWorkspace } from "@/runtime/pi/client/api";
import type { PiWorkspaceSummary } from "@/runtime/pi/contracts";
import { useWorkspaceDirectoryStore } from "@/workbench/workspaces/workspace-directory-store";

export function WorkspaceDirectorySummary(_context: ComposerDrawerSlotContext) {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState(false);
  const isNewThread = useAuiState(
    (state) => state.threads.mainThreadId === state.threads.newThreadId,
  );
  const directories = useWorkspaceDirectoryStore((state) => state.directories);
  const activeDirectoryId = useWorkspaceDirectoryStore((state) => state.activeDirectoryId);
  const draftDirectoryId = useWorkspaceDirectoryStore((state) => state.draftDirectoryId);
  const addDirectory = useWorkspaceDirectoryStore((state) => state.addDirectory);
  const selectedDirectory = directories.find(
    (directory) => directory.id === (isNewThread ? draftDirectoryId : activeDirectoryId),
  );

  const selectWorkspace = (workspace: PiWorkspaceSummary) => {
    addDirectory(workspace);
  };

  const pickDirectory = async () => {
    if (picking) return;
    setPicking(true);
    setError(false);
    try {
      const workspace = await pickPiWorkspace();
      if (workspace) selectWorkspace(workspace);
    } catch {
      setError(true);
    } finally {
      setPicking(false);
    }
  };

  return (
    <>
      <div className="flex min-w-0 items-center gap-3 text-xs">
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
            "group-data-[selected=true]/composer:border-blue-200 group-data-[selected=true]/composer:bg-blue-50 group-data-[selected=true]/composer:text-blue-600 inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-transparent bg-transparent px-2.5 font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none dark:group-data-[selected=true]/composer:border-blue-800 dark:group-data-[selected=true]/composer:bg-blue-950/50 dark:group-data-[selected=true]/composer:text-blue-400",
            error && "text-destructive",
          )}
        >
          {picking ? (
            <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <FolderIcon className="size-3.5 shrink-0" />
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
          <ShieldCheckIcon className="size-3.5" />
          {t("extensions.workspaceDirectory.localPi")}
        </span>
      </div>
    </>
  );
}
