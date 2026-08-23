"use client";

import { ChevronDownIcon, Code2Icon, EyeIcon, FileCode2Icon, FoldersIcon } from "lucide-react";
import { useCallback } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceProps } from "@/platform/extensions";
import { openPiHostPath } from "@/runtime/pi/client/transport/api";

import { useRightWorkspace, useRightWorkspaceState } from "@/components/right-workspace";
import { cn } from "@/lib/utils";
import { FileBreadcrumbTree } from "./file-breadcrumb-tree";
import type { FileSurfaceParams } from "./file-surface";
import {
  isFileViewerPreviewFile,
  isMarkdownFile,
  resolveFileViewMode,
  toggleFileViewMode,
} from "./file-view-mode";
import { isLargeTextFile } from "./progressive-text-document";

function VisualStudioCodeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0">
      <path
        fill="#22a6f2"
        d="m17.6 2.9 4.1 2v14.2l-4.1 2-9-8.2-4.1 3.2L2.3 14l4-4-4-3.1 2.2-2.1 4.1 3.2 9-8.1Zm0 5.4-5.7 3.7 5.7 3.7V8.3Z"
      />
    </svg>
  );
}

export function FileSurfaceHeader({ surface, context }: WorkspaceSurfaceProps<FileSurfaceParams>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const auxiliaryOpen = useRightWorkspaceState((state) => state.auxiliaryOpen);
  const path = surface.params.absolutePath;
  const markdown = isMarkdownFile(path);
  const largeText =
    surface.params.encoding === "utf-8" && isLargeTextFile(surface.params.size ?? 0);
  const previewToggle =
    !largeText &&
    (markdown ||
      (surface.params.encoding === "utf-8" &&
        isFileViewerPreviewFile(surface.params.absolutePath)));
  const viewMode = resolveFileViewMode(path, surface.params.viewMode);
  const folderPath = path
    ? (context.rootPath ?? (path.replace(/[\\/][^\\/]+$/, "") || path))
    : undefined;
  const openPath = useCallback(
    async (target: string) => {
      try {
        await openPiHostPath(target);
      } catch (error) {
        controller.update(surface.id, {
          status: "error",
          statusMessage: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [controller, surface.id],
  );

  return (
    <div className="flex size-full min-w-0 items-center gap-3 px-3">
      <FileBreadcrumbTree surface={surface} context={context} />

      {viewMode === "diff" ? (
        <button
          type="button"
          aria-label={t("extensions.workspaceFile.viewSource")}
          title={t("extensions.workspaceFile.viewSource")}
          className="hover:bg-muted flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors"
          onClick={() =>
            controller.update(surface.id, {
              params: {
                ...surface.params,
                viewMode: "source",
                diffId: undefined,
                diffCycle: undefined,
              },
            })
          }
        >
          <Code2Icon className="size-[18px]" />
        </button>
      ) : previewToggle ? (
        <button
          type="button"
          aria-pressed={viewMode === "preview"}
          aria-label={
            viewMode === "preview"
              ? t("extensions.workspaceFile.viewSource")
              : t("extensions.workspaceFile.viewPreview")
          }
          title={
            viewMode === "preview"
              ? t("extensions.workspaceFile.viewSource")
              : t("extensions.workspaceFile.viewPreview")
          }
          className={cn(
            "hover:bg-muted flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
            viewMode === "preview" && "bg-muted/55",
          )}
          onClick={() =>
            controller.update(surface.id, {
              params: { ...surface.params, viewMode: toggleFileViewMode(viewMode) },
            })
          }
        >
          {viewMode === "preview" ? (
            <Code2Icon className="size-[18px]" />
          ) : (
            <EyeIcon className="size-[18px]" />
          )}
        </button>
      ) : null}

      <button
        type="button"
        aria-controls="right-workspace-auxiliary-pane"
        aria-expanded={auxiliaryOpen}
        aria-label={
          auxiliaryOpen
            ? t("extensions.workspaceFile.hideFileTree")
            : t("extensions.workspaceFile.showFileTree")
        }
        title={
          auxiliaryOpen
            ? t("extensions.workspaceFile.hideFileTree")
            : t("extensions.workspaceFile.showFileTree")
        }
        className={cn(
          "hover:bg-muted flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
          auxiliaryOpen && "bg-muted/55",
        )}
        onClick={() => controller.setAuxiliaryOpen(!auxiliaryOpen)}
      >
        <FoldersIcon className="size-[18px]" />
      </button>

      {path && folderPath ? (
        <div className="flex h-7 shrink-0 items-stretch overflow-hidden rounded-lg border bg-background shadow-xs">
          <button
            type="button"
            className="hover:bg-muted flex items-center gap-2 px-3 text-sm font-medium transition-colors"
            onClick={() => void openPath(path)}
          >
            <VisualStudioCodeIcon />
            {t("extensions.workspaceFile.open")}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("extensions.workspaceFile.openOptions")}
              title={t("extensions.workspaceFile.openOptions")}
              className="hover:bg-muted flex w-7 items-center justify-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset"
            >
              <ChevronDownIcon className="text-muted-foreground size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => void openPath(path)}>
                <FileCode2Icon className="text-blue-500" />
                {t("extensions.workspaceFile.openFile")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void openPath(folderPath)}>
                <FoldersIcon />
                {t("extensions.workspaceFile.openWorkspaceFolder")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}
