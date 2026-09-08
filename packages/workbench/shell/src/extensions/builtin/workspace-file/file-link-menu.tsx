"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useStore } from "zustand";
import { useWorkbenchRuntimeHostCapability } from "@workbench/agent-runtime-client/context";
import type {
  WorkbenchLocalApp,
  WorkbenchLocalFileDescriptor,
} from "@workbench/host-contracts/runtime-capabilities";
import { writeClipboardText } from "../../../clipboard";
import { saveFileAs } from "../../../file-download";
import { useI18n } from "../../../i18n";
import { useOpenerService, useWorkspaceContext } from "../../../right-workspace-react";
import { useWorkbenchSettingsResource } from "../../../settings";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../../ui/context-menu";
import { useToastManager } from "../../../ui/toast";
import { fileLinkResource, openFileLink } from "../../../workspace-files/file-link";
import { useWorkspaceFileRuntime } from "../../../workspace-files/workspace-file-runtime";
import {
  compatibleLocalFileApps,
  fileOpenPreferenceKey,
  fileOpenSelectors,
  localAppFileKindFor,
} from "./file-open-apps";
import {
  createFileOpenPreferences,
  FILE_OPEN_PREFERENCES,
  rememberFileOpenApp,
} from "./file-open-preferences";
import { readFileLinkText, unsavedFileLinkContent } from "./file-link-content";
import { LocalAppIcon } from "./local-app-icon";

const fileLinkMenuSpacing =
  "p-[var(--control-content-padding-block-default)] [--control-content-padding-block-compact-start:var(--control-content-padding-block-default-start)] [--control-content-padding-block-compact-end:var(--control-content-padding-block-default-end)]";

export function FileLinkContextMenu({ href, children }: { href: string; children: ReactElement }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className={`w-max max-w-(--available-width) ${fileLinkMenuSpacing}`}>
        <FileLinkMenuItems key={href} href={href} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

// The shared menu portal mounts these hooks only when the user opens the menu.
function FileLinkMenuItems({ href }: { href: string }) {
  const { t } = useI18n();
  const host = useWorkbenchRuntimeHostCapability();
  const context = useWorkspaceContext();
  const opener = useOpenerService();
  const { files } = useWorkspaceFileRuntime();
  const notifications = useToastManager();
  const preferences = useWorkbenchSettingsResource(
    FILE_OPEN_PREFERENCES,
    createFileOpenPreferences,
  );
  const preferredAppIds = useStore(preferences, (state) => state.appIds);
  const [descriptor, setDescriptor] = useState<WorkbenchLocalFileDescriptor | null>();
  const [apps, setApps] = useState<readonly WorkbenchLocalApp[] | null>();
  const [preferenceError, setPreferenceError] = useState(false);
  const [pending, setPending] = useState(false);
  let resourcePath: string | undefined;
  try {
    resourcePath = fileLinkResource(href, context.rootPath)?.path;
  } catch {
    /* A relative link may have no project context. */
  }
  const path = descriptor?.absolutePath ?? resourcePath;
  const fileKind = localAppFileKindFor(path, descriptor?.mediaType, descriptor?.encoding);
  const choices = compatibleLocalFileApps(apps ?? [], fileKind, path);
  const primary = fileOpenSelectors(apps ?? [], path, fileKind, preferredAppIds)[0]?.primaryApp;
  const primaryLabel = primary
    ? t("extensions.workspaceFile.openWith", { name: primary.name })
    : t("extensions.workspaceFile.openFile");
  const scope = context.threadId
    ? { type: "thread" as const, key: context.threadId }
    : { type: "application" as const, key: context.applicationId };
  const bufferContent = () =>
    unsavedFileLinkContent(
      path
        ? (files.getSnapshot({ scope }, path) ??
            (resourcePath ? files.getSnapshot({ scope }, resourcePath) : undefined))
        : undefined,
    );
  const dirty = bufferContent() !== undefined;

  useEffect(() => {
    let active = true;
    setDescriptor(undefined);
    setApps(undefined);
    void Promise.allSettled([
      host?.files && resourcePath
        ? host.files.describeFile(resourcePath)
        : Promise.reject(new Error("Local files unavailable")),
      host ? host.listLocalApps() : Promise.reject(new Error("Local apps unavailable")),
      preferences.getState().hydrate(),
    ]).then(([file, applications, settings]) => {
      if (!active) return;
      setDescriptor(file.status === "fulfilled" ? file.value : null);
      setApps(applications.status === "fulfilled" ? applications.value : null);
      setPreferenceError(settings.status === "rejected");
    });
    return () => {
      active = false;
    };
  }, [host, preferences, resourcePath]);

  const run = async (action: () => Promise<unknown>, success?: string) => {
    if (pending) return;
    setPending(true);
    try {
      await action();
      if (success) notifications.add({ type: "success", title: success });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      console.warn("[file-link] action failed", error);
      notifications.add({
        type: "error",
        title: t("extensions.workspaceFile.linkMenu.actionFailed"),
      });
    } finally {
      setPending(false);
    }
  };
  const openWith = async (app?: WorkbenchLocalApp) => {
    if (!host || !path) return;
    if (
      (app?.kind === "browser" || (!app && fileKind === "html")) &&
      bufferContent() !== undefined
    ) {
      notifications.add({ type: "error", title: t("extensions.workspaceFile.saveBeforeBrowser") });
      return;
    }
    if (app) await host.openLocalApp({ appId: app.id, target: path });
    else await host.openPath(path);
    const fileKey = fileOpenPreferenceKey(path, fileKind);
    try {
      await rememberFileOpenApp(
        preferences,
        app?.kind === "browser" ? `browser:${fileKey}` : fileKey,
        app,
        apps ?? [],
      );
    } catch {
      notifications.add({
        type: "error",
        title: t("extensions.workspaceFile.openPreferenceSaveFailed"),
      });
    }
  };
  const copy = async (value: string) => {
    if (!(await writeClipboardText(value))) throw new Error("Clipboard write failed");
  };
  const unavailable = !descriptor || pending;
  const status =
    descriptor === null
      ? t("extensions.workspaceFile.loadFailed")
      : apps === null
        ? t("extensions.workspaceFile.localAppsLoadError")
        : preferenceError
          ? t("extensions.workspaceFile.openPreferenceLoadFailed")
          : !descriptor
            ? t("extensions.workspaceFile.loading")
            : !apps
              ? t("extensions.workspaceFile.loadingLocalApps")
              : undefined;

  return (
    <>
      <ContextMenuItem
        data-inset
        onClick={() => run(() => openFileLink(opener, context, href))}
        disabled={pending}
      >
        {t("extensions.workspaceFile.linkMenu.openFile")}
      </ContextMenuItem>
      <ContextMenuItem
        data-inset={!primary || undefined}
        onClick={() => run(() => openWith(primary))}
        disabled={
          unavailable ||
          !apps ||
          (primary?.kind === "browser" && dirty) ||
          (!primary && fileKind === "html" && dirty)
        }
        title={
          (primary?.kind === "browser" || (!primary && fileKind === "html")) && dirty
            ? t("extensions.workspaceFile.saveBeforeBrowser")
            : undefined
        }
      >
        {primary ? <LocalAppIcon app={primary} /> : null}
        {primaryLabel}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger inset disabled={unavailable || !apps}>
          {t("extensions.workspaceFile.openWithApps")}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className={fileLinkMenuSpacing}>
          {choices.map((app) => (
            <ContextMenuItem
              key={app.id}
              onClick={() => run(() => openWith(app))}
              disabled={pending || (app.kind === "browser" && dirty)}
              title={
                app.kind === "browser" && dirty
                  ? t("extensions.workspaceFile.saveBeforeBrowser")
                  : undefined
              }
            >
              <LocalAppIcon app={app} />
              {app.name}
            </ContextMenuItem>
          ))}
          {choices.length ? <ContextMenuSeparator /> : null}
          <ContextMenuItem
            data-inset
            onClick={() => run(() => openWith())}
            disabled={pending || (fileKind === "html" && dirty)}
            title={
              fileKind === "html" && dirty
                ? t("extensions.workspaceFile.saveBeforeBrowser")
                : undefined
            }
          >
            {t("extensions.workspaceFile.openFile")}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        data-inset
        disabled={unavailable || !host?.files}
        onClick={() =>
          run(() =>
            saveFileAs(descriptor!.name, async () => {
              const current = bufferContent();
              return current !== undefined
                ? new Blob([current], { type: descriptor!.mediaType })
                : host!.files!.fetchFileContent(descriptor!.absolutePath);
            }),
          )
        }
      >
        {t("extensions.workspaceFile.linkMenu.saveAs")}
      </ContextMenuItem>
      <ContextMenuItem
        data-inset
        disabled={!path || path.startsWith("~") || pending}
        onClick={() => run(() => copy(path!), t("extensions.workspaceFile.linkMenu.pathCopied"))}
      >
        {t("extensions.workspaceFile.linkMenu.copyPath")}
      </ContextMenuItem>
      <ContextMenuItem
        data-inset
        disabled={unavailable || descriptor?.encoding !== "utf-8" || !host?.files}
        onClick={() =>
          run(
            async () =>
              copy(
                await readFileLinkText(
                  host!.files!,
                  descriptor!.absolutePath,
                  descriptor!.size,
                  bufferContent(),
                ),
              ),
            t("extensions.workspaceFile.contentCopied"),
          )
        }
      >
        {t("extensions.workspaceFile.copyContent")}
      </ContextMenuItem>
      <ContextMenuItem
        data-inset
        disabled={unavailable || !apps?.some((app) => app.id === "file-manager")}
        onClick={() => run(() => host!.openLocalApp({ appId: "file-manager", target: path! }))}
      >
        {t("extensions.workspaceFile.linkMenu.showInFolder")}
      </ContextMenuItem>
      {status ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem data-inset disabled>
            {status}
          </ContextMenuItem>
        </>
      ) : null}
    </>
  );
}
