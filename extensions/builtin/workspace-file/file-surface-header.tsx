"use client";

import {
  ChevronDownIcon,
  Code2Icon,
  EyeIcon,
  FileCode2Icon,
  FolderIcon,
  FoldersIcon,
  LoaderCircleIcon,
  SaveIcon,
  TerminalIcon,
} from "lucide-react";
import Image, { type StaticImageData } from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { WorkspaceSurfaceProps } from "@/platform/extensions";
import { listPiLocalApps, openPiHostPath, openPiLocalApp } from "@/runtime/pi/client/transport/api";
import type { LocalAppView } from "@/runtime/pi/rpc-contracts";
import { fileWorkspaceContext } from "@/services/workspace-file-service";

import { useRightWorkspace, useRightWorkspaceState } from "@/components/right-workspace";
import { cn } from "@/lib/utils";
import { FileBreadcrumbTree } from "./file-breadcrumb-tree";
import { saveFileBuffer } from "./file-buffer-actions";
import { browserFileBufferDraftStorage } from "./file-buffer-draft";
import cursorIcon from "./icons/cursor.svg";
import datagripIcon from "./icons/datagrip.svg";
import ideaIcon from "./icons/idea.svg";
import pycharmIcon from "./icons/pycharm.svg";
import qoderIcon from "./icons/qoder.svg";
import traeIcon from "./icons/trae.svg";
import vscodeIcon from "./icons/vscode.svg";
import webstormIcon from "./icons/webstorm.svg";
import type { FileSurfaceParams } from "./file-surface";
import {
  isFileViewerPreviewFile,
  isMarkdownFile,
  resolveFileViewMode,
  toggleFileViewMode,
} from "./file-view-mode";
import { isLargeTextFile } from "./progressive-text-document";

const LOCAL_APP_ICON_SOURCES: Readonly<Record<string, StaticImageData>> = {
  cursor: cursorIcon,
  datagrip: datagripIcon,
  idea: ideaIcon,
  pycharm: pycharmIcon,
  qoder: qoderIcon,
  trae: traeIcon,
  vscode: vscodeIcon,
  webstorm: webstormIcon,
};

function LocalAppIcon({ app }: { app?: LocalAppView }) {
  const source = app?.icon ? LOCAL_APP_ICON_SOURCES[app.icon] : undefined;
  const [failedSource, setFailedSource] = useState<string>();
  if (source && failedSource !== source.src) {
    return (
      <Image
        aria-hidden="true"
        src={source}
        alt=""
        width={16}
        height={16}
        unoptimized
        className={cn(
          "size-4 shrink-0 object-contain",
          app?.icon === "qoder" && "rounded-[3px] bg-[#101114] p-px",
        )}
        onError={() => setFailedSource(source.src)}
      />
    );
  }
  if (app?.kind === "terminal") return <TerminalIcon className="size-4 shrink-0" />;
  if (app?.kind === "file-manager") return <FolderIcon className="size-4 shrink-0" />;
  return <Code2Icon className="size-4 shrink-0" />;
}

export function FileSurfaceHeader({ surface, context }: WorkspaceSurfaceProps<FileSurfaceParams>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const auxiliaryOpen = useRightWorkspaceState((state) => state.auxiliaryOpen);
  const [saving, setSaving] = useState(false);
  const [localApps, setLocalApps] = useState<LocalAppView[]>([]);
  const [localAppsLoading, setLocalAppsLoading] = useState(true);
  const [localAppsError, setLocalAppsError] = useState(false);
  const path = surface.params.absolutePath;
  const fileContext = useMemo(
    () => fileWorkspaceContext(surface.scope, context),
    [context, surface.scope],
  );
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
  const editorApps = useMemo(() => localApps.filter((app) => app.kind === "editor"), [localApps]);
  const systemApps = useMemo(() => localApps.filter((app) => app.kind !== "editor"), [localApps]);
  const primaryApp = editorApps[0];
  const localAppName = useCallback(
    (app: LocalAppView) => {
      if (app.id === "terminal") return t("extensions.workspaceFile.terminal");
      if (app.id === "file-manager") return t("extensions.workspaceFile.fileManager");
      return app.name;
    },
    [t],
  );
  useEffect(() => {
    let active = true;
    void listPiLocalApps()
      .then(({ apps }) => {
        if (!active) return;
        setLocalApps(apps);
        setLocalAppsError(false);
      })
      .catch(() => {
        if (active) setLocalAppsError(true);
      })
      .finally(() => {
        if (active) setLocalAppsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
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
  const openWithLocalApp = useCallback(
    async (app: LocalAppView, target: string) => {
      try {
        await openPiLocalApp({ appId: app.id, target });
      } catch {
        controller.update(surface.id, {
          status: "error",
          statusMessage: t("extensions.workspaceFile.openWithError", {
            name: localAppName(app),
          }),
        });
      }
    },
    [controller, localAppName, surface.id, t],
  );
  const save = useCallback(async () => {
    if (!path || saving) return;
    setSaving(true);
    try {
      const available = await saveFileBuffer({
        context: fileContext,
        path,
        storage: browserFileBufferDraftStorage(),
        surfaceId: surface.id,
      });
      if (!available) return;
      controller.update(surface.id, { dirty: false, status: "ready", statusMessage: undefined });
    } catch (error) {
      controller.update(surface.id, {
        status: "error",
        statusMessage: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }, [controller, fileContext, path, saving, surface.id]);

  return (
    <div className="flex size-full min-w-0 items-center gap-3 px-3">
      <FileBreadcrumbTree surface={surface} context={context} />

      {surface.dirty && path ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={saving}
          aria-label={
            saving ? t("extensions.workspaceFile.saving") : t("extensions.workspaceFile.save")
          }
          title={saving ? t("extensions.workspaceFile.saving") : t("extensions.workspaceFile.save")}
          onClick={() => void save()}
        >
          {saving ? (
            <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <SaveIcon className="size-4" />
          )}
        </Button>
      ) : null}

      {viewMode === "diff" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("extensions.workspaceFile.viewSource")}
          title={t("extensions.workspaceFile.viewSource")}
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
          <Code2Icon className="size-4" />
        </Button>
      ) : previewToggle ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
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
          className={cn(viewMode === "preview" && "bg-muted/55")}
          onClick={() =>
            controller.update(surface.id, {
              params: { ...surface.params, viewMode: toggleFileViewMode(viewMode) },
            })
          }
        >
          {viewMode === "preview" ? (
            <Code2Icon className="size-4" />
          ) : (
            <EyeIcon className="size-4" />
          )}
        </Button>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
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
        className={cn(auxiliaryOpen && "bg-muted/55")}
        onClick={() => controller.setAuxiliaryOpen(!auxiliaryOpen)}
      >
        <FoldersIcon className="size-4" />
      </Button>

      {path && folderPath ? (
        <div className="flex h-7 w-14 shrink-0 items-stretch overflow-hidden rounded-lg border bg-background shadow-xs">
          <button
            type="button"
            aria-label={
              primaryApp
                ? t("extensions.workspaceFile.openWith", { name: localAppName(primaryApp) })
                : t("extensions.workspaceFile.openFile")
            }
            title={
              primaryApp
                ? t("extensions.workspaceFile.openWith", { name: localAppName(primaryApp) })
                : t("extensions.workspaceFile.openFile")
            }
            className="hover:bg-muted flex w-7 items-center justify-center transition-colors"
            onClick={() => void (primaryApp ? openWithLocalApp(primaryApp, path) : openPath(path))}
          >
            <LocalAppIcon app={primaryApp} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("extensions.workspaceFile.openOptions")}
              title={t("extensions.workspaceFile.openOptions")}
              className="hover:bg-muted flex w-7 items-center justify-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset"
            >
              <ChevronDownIcon className="text-muted-foreground size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("extensions.workspaceFile.openWithApps")}</DropdownMenuLabel>
                {localAppsLoading && localApps.length === 0 ? (
                  <DropdownMenuItem disabled>
                    <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                    {t("extensions.workspaceFile.loadingLocalApps")}
                  </DropdownMenuItem>
                ) : null}
                {editorApps.map((app) => (
                  <DropdownMenuItem key={app.id} onClick={() => void openWithLocalApp(app, path)}>
                    <LocalAppIcon app={app} />
                    {localAppName(app)}
                  </DropdownMenuItem>
                ))}
                {!localAppsLoading && editorApps.length === 0 ? (
                  <DropdownMenuItem onClick={() => void openPath(path)}>
                    <FileCode2Icon />
                    {t("extensions.workspaceFile.openFile")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
              {systemApps.length > 0 ? <DropdownMenuSeparator /> : null}
              {systemApps.map((app) => (
                <DropdownMenuItem
                  key={app.id}
                  onClick={() => void openWithLocalApp(app, folderPath)}
                >
                  <LocalAppIcon app={app} />
                  {localAppName(app)}
                </DropdownMenuItem>
              ))}
              {localAppsError ? (
                <DropdownMenuItem disabled>
                  {t("extensions.workspaceFile.localAppsLoadError")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );
}
