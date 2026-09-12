"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { BrowserEvent, BrowserFile, BrowserSettings } from "@workbench/browser-contracts";

import { parseLocalFileHref } from "../../../workspace-files/file-link";
import { defineMessage, useI18n } from "../../../i18n";
import {
  useRightWorkspace,
  useRightWorkspaceState,
  useWorkspaceContext,
} from "../../../right-workspace-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  SettingsField,
  useToastManager,
} from "../../../ui";
import { useBrowserSessionService } from "./browser-session-service";
import { useRightWorkspaceEnvironment } from "../../../right-workspace/right-workspace-context";
import { saveBrowserFile, uploadBrowserFiles } from "./browser-files";

type PromptEvent = Extract<
  BrowserEvent,
  { type: "permission" | "dialog" | "file-chooser" | "file" }
>;
type QueuedPrompt = { id: number; event: PromptEvent };

export function resolveEmbeddedBrowserUrl(
  address: string,
  settings: BrowserSettings,
): URL | undefined {
  try {
    const url = new URL(address);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    const local =
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname) ||
      url.hostname === "[::1]";
    return (local ? settings.localLinks : settings.webLinks) === "embedded" ? url : undefined;
  } catch {
    return;
  }
}

function useBrowserLinkRouting(root: RefObject<HTMLElement | null>, settingsReady: boolean) {
  const browser = useBrowserSessionService();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();
  const surfaces = useRightWorkspaceState((state) => state.surfaces);
  const opening = useRef(new Set<string>());
  const { t } = useI18n();
  const { add } = useToastManager();

  useEffect(() => {
    const shell = root.current?.closest<HTMLElement>("[data-workbench-shell]");
    if (!shell || !settingsReady) return;
    const open = (url: URL) => {
      if (opening.current.has(url.href)) return;
      opening.current.add(url.href);
      const existing = Object.values(surfaces).find(
        (surface) =>
          surface.kind === "browser" &&
          surface.scope.key === (context.threadId ?? context.applicationId) &&
          typeof surface.params.browserSessionId === "string" &&
          browser.getSession(surface.params.browserSessionId)?.url === url.href,
      );
      const session =
        existing && typeof existing.params.browserSessionId === "string"
          ? browser.getSession(existing.params.browserSessionId)
          : undefined;
      void Promise.resolve(
        session ??
          browser.create({
            projectId: context.projectId ?? context.applicationId,
            threadId: context.threadId,
            url: url.href,
          }),
      )
        .then((current) =>
          controller.reveal({
            kind: "browser",
            title: current.title || defineMessage("extensions.workspaceBrowser.title"),
            params: { browserSessionId: current.id, url: current.url },
            context,
            status: "ready",
            policy: "force-focus",
          }),
        )
        .catch(() =>
          add({ type: "error", title: t("extensions.workspaceBrowser.events.openError") }),
        )
        .finally(() => opening.current.delete(url.href));
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      const anchor = target.closest<HTMLAnchorElement>(
        'a[href][target="_blank"], a[href][data-markdown="link"]',
      );
      if (
        !anchor ||
        anchor.closest("[data-workbench-shell]") !== shell ||
        anchor.hasAttribute("download") ||
        anchor.closest("[data-browser-external]")
      )
        return;
      // The native shell listener runs before React's FileLink handler. Inspect the
      // authored href: anchor.href resolves local paths against the app's HTTP origin.
      const href = anchor.getAttribute("href");
      if (!href || parseLocalFileHref(href)) return;
      const url = resolveEmbeddedBrowserUrl(anchor.href, browser.getSettings());
      if (!url) return;
      event.preventDefault();
      open(url);
    };
    const confirmedLink = (event: Event) => {
      const target = event.target as Element | null;
      if (
        event.defaultPrevented ||
        !event.cancelable ||
        target?.closest?.("[data-workbench-shell]") !== shell
      )
        return;
      const detail: unknown = (event as CustomEvent).detail;
      if (
        !detail ||
        typeof detail !== "object" ||
        !("url" in detail) ||
        typeof detail.url !== "string"
      )
        return;
      const url = resolveEmbeddedBrowserUrl(detail.url, browser.getSettings());
      if (!url) return;
      event.preventDefault();
      open(url);
    };
    shell.addEventListener("click", click);
    shell.addEventListener("workbench:open-browser-link", confirmedLink);
    return () => {
      shell.removeEventListener("click", click);
      shell.removeEventListener("workbench:open-browser-link", confirmedLink);
    };
  }, [add, browser, context, controller, root, settingsReady, surfaces, t]);
}

function BrowserPromptDialog({ event, onDone }: { event: PromptEvent; onDone(): void }) {
  const browser = useBrowserSessionService();
  const { t } = useI18n();
  const id = useId();
  const [answer, setAnswer] = useState(event.type === "dialog" ? (event.defaultPrompt ?? "") : "");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"fileTooLarge" | "actionError">();
  const address =
    event.type === "permission"
      ? event.origin
      : event.type === "dialog" && event.url
        ? event.url
        : "sessionId" in event
          ? (browser.getSession(event.sessionId)?.url ??
            t("extensions.workspaceBrowser.events.unknownWebsite"))
          : undefined;
  const title =
    event.type === "permission"
      ? t("extensions.workspaceBrowser.events.permissionTitle")
      : event.type === "file-chooser"
        ? t("extensions.workspaceBrowser.events.chooseFiles")
        : event.type === "file"
          ? t("extensions.workspaceBrowser.events.saveDownload")
          : t(
              event.kind === "prompt"
                ? "extensions.workspaceBrowser.events.websitePrompt"
                : event.kind === "alert"
                  ? "extensions.workspaceBrowser.events.websiteMessage"
                  : "extensions.workspaceBrowser.events.websiteConfirmation",
            );
  const description =
    event.type === "permission"
      ? t(`extensions.workspaceBrowser.events.${event.action}`)
      : event.type === "file-chooser"
        ? t("extensions.workspaceBrowser.events.uploadDescription")
        : event.type === "file"
          ? t("extensions.workspaceBrowser.events.saveDownloadDescription")
          : t("extensions.workspaceBrowser.events.websiteDialogDescription");
  const respond = async (accept: boolean) => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      if (event.type === "permission")
        await browser.command({
          type: "permission.respond",
          requestId: event.requestId,
          allow: accept,
        });
      else if (event.type === "dialog")
        await browser.command({
          type: "dialog.respond",
          sessionId: event.sessionId,
          accept,
          ...(event.kind === "prompt" ? { text: answer } : {}),
        });
      else if (event.type === "file-chooser")
        await browser.command({
          type: "upload",
          sessionId: event.sessionId,
          requestId: event.requestId,
          files: accept ? await uploadBrowserFiles(files) : [],
        });
      else if (accept) await saveBrowserFile(event.file, true);
      onDone();
    } catch (failure) {
      if (
        event.type === "permission" &&
        failure instanceof Error &&
        "code" in failure &&
        failure.code === "browser-invalid"
      ) {
        onDone();
        return;
      }
      setError(
        failure instanceof Error && failure.message === "browser-file-too-large"
          ? "fileTooLarge"
          : "actionError",
      );
    } finally {
      setPending(false);
    }
  };
  const confirmLabel =
    event.type === "permission"
      ? t("extensions.workspaceBrowser.events.allow")
      : event.type === "file-chooser"
        ? t("extensions.workspaceBrowser.events.uploadFiles")
        : event.type === "file"
          ? t("extensions.workspaceBrowser.events.saveFile")
          : t(
              event.kind === "alert"
                ? "extensions.workspaceBrowser.events.ok"
                : "extensions.workspaceBrowser.events.confirm",
            );

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        closeLabel={t("extensions.workspaceBrowser.events.close")}
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {address ? (
          <SettingsField label={t("extensions.workspaceBrowser.events.website")}>
            <code className="block max-h-24 overflow-auto rounded-[var(--radius)] bg-muted p-3 text-sm break-all">
              {address}
            </code>
          </SettingsField>
        ) : null}
        {event.type === "dialog" ? (
          <p className="max-h-60 overflow-auto text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
            {event.message}
          </p>
        ) : null}
        <form
          className="contents"
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            void respond(true);
          }}
        >
          {event.type === "dialog" && event.kind === "prompt" ? (
            <SettingsField
              label={<label htmlFor={id}>{t("extensions.workspaceBrowser.events.response")}</label>}
            >
              <Input
                id={id}
                value={answer}
                maxLength={65536}
                disabled={pending}
                onChange={(inputEvent) => setAnswer(inputEvent.currentTarget.value)}
              />
            </SettingsField>
          ) : null}
          {event.type === "file-chooser" ? (
            <SettingsField
              label={<label htmlFor={id}>{t("extensions.workspaceBrowser.events.files")}</label>}
            >
              <Input
                id={id}
                type="file"
                multiple={event.multiple}
                disabled={pending}
                onChange={(inputEvent) =>
                  setFiles(Array.from(inputEvent.currentTarget.files ?? []))
                }
              />
            </SettingsField>
          ) : null}
          {event.type === "file" ? <p className="text-sm break-all">{event.file.name}</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`extensions.workspaceBrowser.events.${error}`)}
            </p>
          ) : null}
          <DialogFooter closeLabel={t("extensions.workspaceBrowser.events.cancel")}>
            {event.type !== "dialog" || event.kind !== "alert" ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => void respond(false)}
              >
                {t(
                  event.type === "permission"
                    ? "extensions.workspaceBrowser.events.deny"
                    : "extensions.workspaceBrowser.events.cancel",
                )}
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={pending || (event.type === "file-chooser" && files.length === 0)}
            >
              {pending ? t("extensions.workspaceBrowser.events.working") : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BrowserEventsOverlay() {
  const browser = useBrowserSessionService();
  const { controller, store, context } = useRightWorkspaceEnvironment();
  const { t } = useI18n();
  const { add } = useToastManager();
  const root = useRef<HTMLSpanElement>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  const sequence = useRef(0);
  const completedDownloads = useRef(new Set<string>());
  useBrowserLinkRouting(root, settingsReady);

  useEffect(() => {
    let active = true;
    void browser
      .loadSettings()
      .then(() => {
        if (active) setSettingsReady(true);
      })
      .catch((error: unknown) =>
        console.error("[workbench.browser] Could not load browser preferences", error),
      );
    return () => {
      active = false;
    };
  }, [browser]);
  useEffect(
    () =>
      browser.subscribeEvents((event) => {
        if (event.type === "settings") setSettingsReady(true);
        if (event.type === "popup") {
          const state = store.getState();
          const opener = Object.values(state.surfaces).find(
            (surface) =>
              surface.kind === "browser" &&
              surface.params.browserSessionId === event.openerSessionId,
          );
          if (opener)
            controller.reveal({
              kind: "browser",
              title: event.session.title || defineMessage("extensions.workspaceBrowser.title"),
              params: { browserSessionId: event.session.id, url: event.session.url },
              context: {
                ...context,
                projectId: event.session.projectId,
                threadId: opener.scope.type === "thread" ? opener.scope.key : undefined,
              },
              scope: opener.scope,
              status: "ready",
              policy: state.activeSurfaceId === opener.id ? "reveal" : "background",
            });
        }
        if (
          event.type === "permission" ||
          event.type === "dialog" ||
          event.type === "file-chooser" ||
          event.type === "file"
        ) {
          const id = ++sequence.current;
          setQueue((current) => {
            if (
              current.some(
                (item) =>
                  ("requestId" in event &&
                    "requestId" in item.event &&
                    item.event.requestId === event.requestId) ||
                  (event.type === "dialog" &&
                    item.event.type === "dialog" &&
                    event.sessionId === item.event.sessionId),
              )
            )
              return current;
            return [...current, { id, event }];
          });
        }
        if (
          event.type === "download" &&
          event.download.state === "completed" &&
          !completedDownloads.current.has(event.download.id)
        ) {
          completedDownloads.current.add(event.download.id);
          if (!browser.getSettings().askDownloadLocation) {
            void browser
              .command<BrowserFile>({ type: "download.read", downloadId: event.download.id })
              .then((file) => saveBrowserFile(file))
              .then(() =>
                add({
                  type: "success",
                  title: t("extensions.workspaceBrowser.events.downloadReady", {
                    name: event.download.name,
                  }),
                }),
              )
              .catch(() =>
                add({
                  type: "error",
                  title: t("extensions.workspaceBrowser.events.downloadFailed", {
                    name: event.download.name,
                  }),
                }),
              );
          }
        }
      }),
    [add, browser, context, controller, store, t],
  );

  const current = queue[0];
  return (
    <>
      <span ref={root} hidden aria-hidden="true" />
      {current ? (
        <BrowserPromptDialog
          key={current.id}
          event={current.event}
          onDone={() => setQueue((items) => items.filter((item) => item.id !== current.id))}
        />
      ) : null}
    </>
  );
}
