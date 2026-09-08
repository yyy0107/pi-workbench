"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  Code2Icon,
  CopyIcon,
  EyeIcon,
  FileArchiveIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FoldersIcon,
  Globe2Icon,
  ImageIcon,
  LoaderCircleIcon,
  MusicIcon,
  SaveIcon,
  TerminalIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workbench/shell/ui";
import { Button } from "@workbench/shell/ui";
import { useI18n } from "@workbench/shell/i18n";
import { useClipboardCopy } from "@workbench/shell/hooks";
import { useWorkbenchSettingsResource } from "@workbench/shell/settings";
import { useExtensionErrorReporter } from "@workbench/extension-host";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import {
  useWorkbenchRuntimeHostCapability,
  useWorkbenchWorkspaceCapability,
} from "@workbench/agent-runtime-client/context";
import type {
  WorkbenchLocalAppFileKind,
  WorkbenchLocalApp,
} from "@workbench/host-contracts/runtime-capabilities";
import {
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceDraftStore,
} from "@workbench/shell/right-workspace/react";
import { cn } from "@workbench/shell/utils";
import { useWorkbenchDomIds } from "@workbench/shell/dom";
import {
  fileWorkspaceContext,
  resolveFileWorkspaceSession,
} from "@workbench/shell/workspace-files";
import { useWorkspaceFileRuntime } from "@workbench/shell/workspace-files";
import { FileBreadcrumbTree } from "./file-breadcrumb-tree";
import { saveFileBuffer } from "./file-buffer-actions";
import { FILE_SURFACE_OPEN_FAILED, FILE_SURFACE_SAVE_FAILED } from "./file-surface-messages";
import {
  compatibleLocalFileApps,
  compatibleLocalFolderApps,
  localAppFileKindFor,
  localSystemApps,
  fileOpenPreferenceKey,
  preferredLocalApp,
  SYSTEM_DEFAULT_APP_ID,
} from "./file-open-apps";
import { createFileOpenPreferences, FILE_OPEN_PREFERENCES } from "./file-open-preferences";
import { assetModuleUrl, type AssetModule } from "./asset-module-url";
import cursorIcon from "./icons/cursor.svg";
import datagripIcon from "./icons/datagrip.svg";
import ideaIcon from "./icons/idea.svg";
import mpvIcon from "./icons/mpv.svg";
import pycharmIcon from "./icons/pycharm.svg";
import qoderIcon from "./icons/qoder.svg";
import traeIcon from "./icons/trae.svg";
import vlcIcon from "./icons/vlc.svg";
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

const LOCAL_APP_ICON_SOURCES: Readonly<Record<string, AssetModule>> = {
  cursor: cursorIcon,
  datagrip: datagripIcon,
  idea: ideaIcon,
  mpv: mpvIcon,
  pycharm: pycharmIcon,
  qoder: qoderIcon,
  trae: traeIcon,
  vlc: vlcIcon,
  vscode: vscodeIcon,
  webstorm: webstormIcon,
};

function LocalAppIcon({ app }: { app?: WorkbenchLocalApp }) {
  const source = app?.icon ? LOCAL_APP_ICON_SOURCES[app.icon] : undefined;
  const sourceUrl = source ? assetModuleUrl(source) : undefined;
  const [failedSource, setFailedSource] = useState<string>();
  if (sourceUrl && failedSource !== sourceUrl) {
    return (
      <img
        aria-hidden="true"
        src={sourceUrl}
        alt=""
        width={16}
        height={16}
        className={cn(
          "size-[var(--button-icon-size,var(--icon-size-md))] shrink-0 object-contain",
          app?.icon === "qoder" && "rounded-[3px] bg-[#101114] p-px",
        )}
        onError={() => setFailedSource(sourceUrl)}
      />
    );
  }
  if (app?.kind === "terminal") return <TerminalIcon aria-hidden="true" />;
  if (app?.kind === "file-manager") return <FolderIcon aria-hidden="true" />;
  if (app?.kind === "media-player") return <VideoIcon aria-hidden="true" />;
  if (app?.kind === "browser") return <Globe2Icon aria-hidden="true" />;
  if (app?.kind === "image-editor") return <ImageIcon aria-hidden="true" />;
  if (app?.kind === "pdf-reader" || app?.kind === "office") {
    return <FileTextIcon aria-hidden="true" />;
  }
  return <Code2Icon aria-hidden="true" />;
}

function FileKindIcon({ kind }: { kind: WorkbenchLocalAppFileKind }) {
  if (kind === "image") return <ImageIcon aria-hidden="true" />;
  if (kind === "audio") return <MusicIcon aria-hidden="true" />;
  if (kind === "video") return <VideoIcon aria-hidden="true" />;
  if (kind === "pdf" || kind === "document") {
    return <FileTextIcon aria-hidden="true" />;
  }
  if (kind === "archive") return <FileArchiveIcon aria-hidden="true" />;
  if (kind === "text" || kind === "html") return <Code2Icon aria-hidden="true" />;
  return <FileIcon aria-hidden="true" />;
}

export function FileSurfaceHeader(props: WorkspaceSurfaceProps<FileSurfaceParams>) {
  const workspace = useWorkbenchWorkspaceCapability();
  return props.surface.params.source === "workspace" && !workspace ? null : (
    <AvailableFileSurfaceHeader {...props} />
  );
}

function AvailableFileSurfaceHeader({
  surface,
  context,
  isVisible,
}: WorkspaceSurfaceProps<FileSurfaceParams>) {
  const { t } = useI18n();
  const hostClient = useWorkbenchRuntimeHostCapability();
  const { files } = useWorkspaceFileRuntime();
  const draftStore = useWorkspaceDraftStore();
  const controller = useRightWorkspace();
  const domIds = useWorkbenchDomIds();
  const reportError = useExtensionErrorReporter();
  const auxiliaryOpen = useRightWorkspaceState((state) => state.auxiliaryOpen);
  const [saving, setSaving] = useState(false);
  const [localApps, setLocalApps] = useState<readonly WorkbenchLocalApp[]>([]);
  const [localAppsLoading, setLocalAppsLoading] = useState(true);
  const [localAppsError, setLocalAppsError] = useState(false);
  const [opening, setOpening] = useState(false);
  const [preferenceError, setPreferenceError] = useState<"load" | "save">();
  const appPreferences = useWorkbenchSettingsResource(
    FILE_OPEN_PREFERENCES,
    createFileOpenPreferences,
  );
  const preferredAppIds = useStore(appPreferences, (state) => state.appIds);
  const preferencesHydrated = useStore(appPreferences, (state) => state.hydrated);
  const { copy, status: copyStatus, reset: resetCopy } = useClipboardCopy();
  const path = surface.params.absolutePath;
  const fileSession = useMemo(() => resolveFileWorkspaceSession(surface.params), [surface.params]);
  const fileContext = useMemo(
    () =>
      fileSession ? fileWorkspaceContext(surface.scope, fileSession) : { scope: surface.scope },
    [fileSession, surface.scope],
  );
  const subscribe = useCallback(
    (listener: () => void) => (path ? files.watchPath(fileContext, path, listener) : () => {}),
    [fileContext, files, path],
  );
  const getSnapshot = useCallback(
    () => (path ? files.getSnapshot(fileContext, path) : undefined),
    [fileContext, files, path],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(resetCopy, [path, resetCopy, surface.id]);
  const copyLabel = t(
    copyStatus === "copied"
      ? "extensions.workspaceFile.contentCopied"
      : copyStatus === "failed"
        ? "extensions.workspaceFile.copyFailed"
        : "extensions.workspaceFile.copyContent",
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
  const folderPath =
    fileSession?.rootPath ?? (path ? path.replace(/[\\/][^\\/]+$/, "") || path : undefined);
  const fileKind = useMemo(
    () => localAppFileKindFor(path, surface.params.mediaType, surface.params.encoding),
    [path, surface.params.encoding, surface.params.mediaType],
  );
  const fileApps = useMemo(
    () => compatibleLocalFileApps(localApps, fileKind, path),
    [fileKind, localApps, path],
  );
  const folderApps = useMemo(() => compatibleLocalFolderApps(localApps), [localApps]);
  const systemApps = useMemo(() => localSystemApps(localApps), [localApps]);
  const targetApps = path ? fileApps : folderApps;
  const preferenceKey = fileOpenPreferenceKey(path, fileKind);
  const primaryApp = preferredLocalApp(targetApps, fileKind, preferredAppIds[preferenceKey]);
  const openTarget = path ?? folderPath;
  const localAppName = useCallback(
    (app: WorkbenchLocalApp) => {
      if (app.id === "terminal") return t("extensions.workspaceFile.terminal");
      if (app.id === "file-manager") return t("extensions.workspaceFile.fileManager");
      return app.name;
    },
    [t],
  );
  const primaryLabel =
    primaryApp?.kind === "browser"
      ? surface.dirty
        ? t("extensions.workspaceFile.saveBeforeBrowser")
        : t("extensions.workspaceFile.openInBrowser", { name: primaryApp.name })
      : primaryApp
        ? t("extensions.workspaceFile.openWith", { name: localAppName(primaryApp) })
        : t(path ? "extensions.workspaceFile.openFile" : "extensions.workspaceFile.openFolder");
  useEffect(() => {
    let active = true;
    void appPreferences
      .getState()
      .hydrate()
      .catch((error: unknown) => {
        reportError(error, { source: "workspace", contributionId: surface.id });
        if (active) setPreferenceError("load");
      });
    return () => {
      active = false;
    };
  }, [appPreferences, reportError, surface.id]);
  useEffect(() => {
    if (!hostClient) return;
    let active = true;
    void hostClient
      .listLocalApps()
      .then((apps) => {
        if (!active) return;
        setLocalApps(apps);
        setLocalAppsError(false);
      })
      .catch((error: unknown) => {
        reportError(error, { source: "workspace", contributionId: surface.id });
        if (active) setLocalAppsError(true);
      })
      .finally(() => {
        if (active) setLocalAppsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hostClient, reportError, surface.id]);
  const openWithLocalApp = useCallback(
    async (app: WorkbenchLocalApp | undefined, target: string) => {
      if (!hostClient || opening || (app?.kind === "browser" && surface.dirty)) return;
      setOpening(true);
      try {
        if (app) await hostClient.openLocalApp({ appId: app.id, target });
        else await hostClient.openPath(target);
        if (!app || targetApps.some((candidate) => candidate.id === app.id)) {
          try {
            await appPreferences
              .getState()
              .remember(preferenceKey, app?.id ?? SYSTEM_DEFAULT_APP_ID);
            setPreferenceError(undefined);
          } catch (error) {
            reportError(error, { source: "workspace", contributionId: surface.id });
            setPreferenceError("save");
          }
        }
      } catch (error) {
        reportError(error, { source: "workspace", contributionId: surface.id });
        controller.update(surface.id, {
          status: "error",
          statusMessage: FILE_SURFACE_OPEN_FAILED,
        });
      } finally {
        setOpening(false);
      }
    },
    [
      appPreferences,
      controller,
      hostClient,
      opening,
      preferenceKey,
      reportError,
      surface.dirty,
      surface.id,
      targetApps,
    ],
  );
  const save = useCallback(async () => {
    if (!path || saving) return;
    setSaving(true);
    try {
      const available = await saveFileBuffer({
        files,
        context: fileContext,
        path,
        storage: draftStore,
        surfaceId: surface.id,
      });
      if (!available) return;
      controller.update(surface.id, { dirty: false, status: "ready", statusMessage: undefined });
    } catch (error) {
      reportError(error, { source: "workspace", contributionId: surface.id });
      controller.update(surface.id, {
        status: "error",
        statusMessage: FILE_SURFACE_SAVE_FAILED,
      });
    } finally {
      setSaving(false);
    }
  }, [controller, draftStore, fileContext, files, path, reportError, saving, surface.id]);

  return (
    <div className="flex size-full min-w-0 items-center gap-3 px-3">
      <FileBreadcrumbTree surface={surface} context={context} isVisible={isVisible} />

      {fileSession?.source === "workspace" && surface.dirty && path ? (
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

      {path && surface.params.encoding === "utf-8" && snapshot ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={copyLabel}
            title={copyLabel}
            onClick={() => void copy(snapshot.content)}
          >
            {copyStatus === "copied" ? (
              <CheckIcon aria-hidden="true" />
            ) : copyStatus === "failed" ? (
              <XIcon aria-hidden="true" />
            ) : (
              <CopyIcon aria-hidden="true" />
            )}
          </Button>
          <span className="sr-only" role="status">
            {copyStatus === "idle" ? "" : copyLabel}
          </span>
        </>
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

      {fileSession ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-controls={domIds.rightWorkspaceAuxiliaryPane}
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
      ) : null}

      {hostClient && fileSession && openTarget && folderPath ? (
        <div className="flex shrink-0 items-center rounded-[var(--button-radius)] border border-border bg-background">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={primaryLabel}
            title={primaryLabel}
            disabled={
              opening ||
              localAppsLoading ||
              (!preferencesHydrated && !preferenceError) ||
              (primaryApp?.kind === "browser" && surface.dirty)
            }
            onClick={() => void openWithLocalApp(primaryApp, openTarget)}
          >
            {opening ? (
              <LoaderCircleIcon
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : primaryApp ? (
              <LocalAppIcon app={primaryApp} />
            ) : path ? (
              <FileKindIcon kind={fileKind} />
            ) : (
              <FolderIcon aria-hidden="true" />
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" />}
              disabled={opening}
              aria-label={t("extensions.workspaceFile.openOptions")}
              title={t("extensions.workspaceFile.openOptions")}
            >
              <ChevronDownIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-max max-w-(--available-width)">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("extensions.workspaceFile.openWithApps")}</DropdownMenuLabel>
                {localAppsLoading && localApps.length === 0 ? (
                  <DropdownMenuItem disabled>
                    <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                    {t("extensions.workspaceFile.loadingLocalApps")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuRadioGroup value={primaryApp?.id ?? SYSTEM_DEFAULT_APP_ID}>
                  {targetApps.map((app) => (
                    <DropdownMenuRadioItem
                      key={app.id}
                      value={app.id}
                      disabled={opening || (app.kind === "browser" && surface.dirty)}
                      title={
                        app.kind === "browser" && surface.dirty
                          ? t("extensions.workspaceFile.saveBeforeBrowser")
                          : undefined
                      }
                      onClick={() => void openWithLocalApp(app, openTarget)}
                    >
                      <LocalAppIcon app={app} />
                      {localAppName(app)}
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuRadioItem
                    value={SYSTEM_DEFAULT_APP_ID}
                    disabled={opening}
                    onClick={() => void openWithLocalApp(undefined, openTarget)}
                  >
                    {path ? <FileKindIcon kind={fileKind} /> : <FolderIcon aria-hidden="true" />}
                    {t(
                      path
                        ? "extensions.workspaceFile.openFile"
                        : "extensions.workspaceFile.openFolder",
                    )}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
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
              {preferenceError ? (
                <DropdownMenuItem disabled>
                  {t(
                    preferenceError === "load"
                      ? "extensions.workspaceFile.openPreferenceLoadFailed"
                      : "extensions.workspaceFile.openPreferenceSaveFailed",
                  )}
                </DropdownMenuItem>
              ) : null}
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
