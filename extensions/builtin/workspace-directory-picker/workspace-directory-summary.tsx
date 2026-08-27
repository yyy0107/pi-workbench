"use client";

import { useAuiState } from "@assistant-ui/react";
import {
  ChevronDownIcon,
  CloudIcon,
  FolderIcon,
  FolderPlusIcon,
  LoaderCircleIcon,
  MessageCircleIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ComposerSlotContext } from "@/platform/extensions";
import { PiApiError, pickPiHostDirectory } from "@/runtime/pi/client/transport/api";
import type { PiWorkspaceSummary } from "@/runtime/pi/contracts/pi";
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

export function WorkspaceDirectorySummary(_context: ComposerSlotContext) {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const [remotePickerOpen, setRemotePickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState(false);
  const isNewThread = useAuiState(
    (state) => state.threads.mainThreadId === state.threads.newThreadId,
  );
  const { activeWorkspace, draftWorkspace, workspaces } = useWorkspaceSelection();
  const { beginNewThread, beginNewThreadWithCreatedWorkspace, destroyNewThread } =
    useWorkspaceCapabilities();
  const selectedDirectory = isNewThread ? draftWorkspace : activeWorkspace;
  const canClearWorkspace = isNewThread && selectedDirectory !== undefined && !picking;
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const filteredWorkspaces = useMemo(() => {
    const normalizedQuery = workspaceQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return workspaces;
    return workspaces.filter(
      (workspace) =>
        workspace.name.toLocaleLowerCase().includes(normalizedQuery) ||
        workspace.cwd.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [workspaceQuery, workspaces]);

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
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) setWorkspaceQuery("");
        }}
      >
        <div
          title={
            error
              ? t("extensions.workspaceDirectory.selectError")
              : (selectedDirectory?.cwd ?? t("extensions.workspaceDirectory.selectTitle"))
          }
          className={cn(
            "group/workspace inline-flex h-8 min-w-0 max-w-56 items-center rounded-full bg-transparent text-base font-normal text-foreground transition-colors hover:bg-muted focus-within:bg-muted",
            menuOpen && "bg-muted",
            error && "text-destructive",
          )}
        >
          {canClearWorkspace ? (
            <button
              type="button"
              aria-label={t("extensions.workspaceDirectory.clearWorkspace")}
              title={t("extensions.workspaceDirectory.clearWorkspace")}
              className="group/clear relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => {
                setMenuOpen(false);
                setWorkspaceQuery("");
                setError(false);
                destroyNewThread();
              }}
            >
              <FolderIcon
                aria-hidden="true"
                className="size-4 group-hover/workspace:hidden group-focus-visible/clear:hidden"
              />
              <XIcon
                aria-hidden="true"
                className="absolute hidden size-4 group-hover/workspace:block group-focus-visible/clear:block"
              />
            </button>
          ) : null}

          <DropdownMenuTrigger
            type="button"
            disabled={!isNewThread || picking}
            aria-label={t("extensions.workspaceDirectory.selectTitle")}
            className={cn(
              "inline-flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-full pe-2 text-base font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-default disabled:opacity-100",
              canClearWorkspace ? "ps-0" : "ps-2",
            )}
          >
            {!canClearWorkspace ? (
              picking ? (
                <LoaderCircleIcon aria-hidden="true" className="size-4 shrink-0 animate-spin" />
              ) : (
                <FolderIcon aria-hidden="true" className="size-4 shrink-0" />
              )
            ) : null}
            <span className="min-w-0 flex-1 truncate text-start">
              {picking
                ? t("extensions.workspaceDirectory.selecting")
                : error
                  ? t("extensions.workspaceDirectory.selectError")
                  : (selectedDirectory?.name ?? t("extensions.workspaceDirectory.defaultName"))}
            </span>
            <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-60" />
          </DropdownMenuTrigger>
        </div>

        <DropdownMenuContent
          align="start"
          alignOffset={canClearWorkspace ? -32 : 0}
          side="bottom"
          sideOffset={6}
          className="grid max-h-[min(336px,var(--available-height))] w-80 max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl p-0 shadow-xl ring-1 ring-foreground/15"
        >
          <div className="flex h-11 items-center gap-2 border-b px-3">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={workspaceQuery}
              type="search"
              aria-label={t("extensions.workspaceDirectory.searchLabel")}
              placeholder={t("extensions.workspaceDirectory.searchPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => setWorkspaceQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
                  event.stopPropagation();
                }
              }}
            />
          </div>

          <div className="min-h-0 overflow-y-auto p-1">
            {filteredWorkspaces.length ? (
              <DropdownMenuRadioGroup
                value={selectedDirectory?.id ?? ""}
                onValueChange={(workspaceId) => {
                  if (isNewThread) beginNewThread(workspaceId);
                }}
              >
                {filteredWorkspaces.map((workspace) => (
                  <DropdownMenuRadioItem
                    key={workspace.id}
                    value={workspace.id}
                    className="min-h-9 gap-2.5 rounded-lg px-2.5 pe-9 text-sm"
                    title={workspace.cwd}
                  >
                    <FolderIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            ) : (
              <DropdownMenuItem disabled className="min-h-9 px-2.5 text-sm">
                {t("extensions.workspaceDirectory.noSearchResults")}
              </DropdownMenuItem>
            )}
          </div>

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
        </DropdownMenuContent>
      </DropdownMenu>
      <RemoteDirectoryPickerDialog
        open={remotePickerOpen}
        onOpenChange={setRemotePickerOpen}
        onSelectPath={admission.selectPath}
      />
      <ProjectTrustDialog
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
