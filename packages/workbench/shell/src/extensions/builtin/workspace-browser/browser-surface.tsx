"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CameraIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  HistoryIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  MinusIcon,
  MoreVerticalIcon,
  PlusIcon,
  PrinterIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  SmartphoneIcon,
  SquareIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useExtensionErrorReporter, useMainViewService } from "@workbench/extension-host";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";
import type { BrowserDevice, BrowserFile, BrowserPage } from "@workbench/browser-contracts";

import { defineMessage, useI18n } from "../../../i18n";
import { useRightWorkspace, useWorkspaceDraftStore } from "../../../right-workspace-react";
import { createSettingsMainViewRequest } from "../../../settings";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "../../../ui";
import { useBrowserSessionService } from "./browser-session-service";
import { BrowserAnnotationLayer } from "./browser-annotation-layer";
import { BrowserViewport } from "./browser-viewport";
import { BrowserControlBadge } from "./browser-control-indicator";
import { saveBrowserFile } from "./browser-files";
import { BrowserDownloadsDialog } from "./browser-downloads-dialog";
import { BrowserAddressBar } from "./browser-address-bar";
import {
  BrowserDevicePreview,
  BrowserDeviceToolbar,
  type BrowserDevicePreviewScale,
} from "./browser-device-toolbar";

export { browserDisplayAddress } from "./browser-address-bar";

export interface BrowserSurfaceParams extends Record<string, unknown> {
  browserSessionId: string;
  url?: string;
}

export function BrowserSurface({
  surface,
  context,
  isVisible,
  retryToken = 0,
}: WorkspaceSurfaceProps<BrowserSurfaceParams>) {
  const { t, locale } = useI18n();
  const browser = useBrowserSessionService();
  const drafts = useWorkspaceDraftStore();
  const controller = useRightWorkspace();
  const mainViews = useMainViewService();
  const reportError = useExtensionErrorReporter();
  useSyncExternalStore(browser.subscribe.bind(browser), browser.getRevision.bind(browser), () => 0);
  const sessionId = surface.params.browserSessionId;
  const session = browser.getSession(sessionId);
  const settings = browser.getSettings();
  const [address, setAddress] = useState(session?.url ?? surface.params.url ?? "about:blank");
  const [error, setError] = useState(false);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<boolean>();
  const [device, setDevice] = useState<BrowserDevice | undefined>(session?.device);
  const [previewScale, setPreviewScale] = useState<BrowserDevicePreviewScale>("fit");
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const browserArea = useRef<HTMLDivElement>(null);
  const importType = useRef<"cookies.import" | "passwords.import">("cookies.import");
  const draftKey = `workbench:browser-address-draft:v2:${sessionId}`;
  const fail = (cause: unknown) => {
    reportError(cause, { source: "workspace", contributionId: surface.id });
    setError(true);
  };
  const run = (action: () => Promise<unknown>) => {
    setError(false);
    void action().catch(fail);
  };
  const restore = () =>
    browser.command({
      type: "attach",
      sessionId,
      projectId: context.projectId ?? context.applicationId,
      url: surface.params.url ?? "about:blank",
    });
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const failureRef = useRef(fail);
  failureRef.current = fail;
  useEffect(() => {
    if (browser.getSession(sessionId)) return;
    let current = true;
    void restoreRef.current().catch((cause: unknown) => {
      if (current) failureRef.current(cause);
    });
    return () => {
      current = false;
    };
  }, [browser, sessionId]);
  useEffect(() => {
    setDevice(session?.device);
  }, [session?.device?.width, session?.device?.height, session?.device?.mobile]);

  useEffect(() => {
    try {
      setAddress(drafts.getItem(draftKey) ?? session?.url ?? surface.params.url ?? "about:blank");
    } catch {
      setAddress(session?.url ?? surface.params.url ?? "about:blank");
    }
  }, [drafts, draftKey, session?.url, surface.params.url]);

  useEffect(() => {
    if (!session) return;
    const title =
      session.url === "about:blank"
        ? defineMessage("extensions.workspaceBrowser.title")
        : session.title;
    if (
      surface.params.url === session.url &&
      (surface.title === title || session.url === "about:blank")
    )
      return;
    controller.update(surface.id, { title, params: { ...surface.params, url: session.url } });
  }, [controller, session?.url, session?.title, surface.id, surface.title, surface.params]);

  const navigate = (value = address) =>
    run(async () => {
      setAddress(value);
      if (!browser.getSession(sessionId)) await restore();
      await browser.navigate(sessionId, value);
      try {
        drafts.removeItem(draftKey);
      } catch {
        /* The address remains usable without draft storage. */
      }
      setAddress(browser.getSession(sessionId)?.url ?? value);
    });
  const retry = useRef(navigate);
  retry.current = navigate;
  useEffect(() => {
    if (retryToken) retry.current();
  }, [retryToken]);

  if (!session)
    return (
      <div
        role={error ? "alert" : "status"}
        className="flex items-center gap-2 p-4 text-sm text-muted-foreground"
      >
        <span>
          {t(error ? "rightWorkspace.status.disconnected" : "rightWorkspace.status.loading")}
        </span>
        {error ? (
          <Button variant="ghost" size="sm" onClick={() => run(restore)}>
            {t("extensions.workspaceBrowser.settings.retry")}
          </Button>
        ) : null}
      </div>
    );

  const zoom = session.zoom ?? settings.defaultZoom;
  const zoomLabel = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(zoom);
  const loading = session.status === "loading";
  const isBlank = session.url === "about:blank";
  const viewport = (patch: { zoom: number }) =>
    run(() =>
      browser.command({
        type: "viewport",
        sessionId,
        width: Math.max(1, Math.round(browserArea.current?.clientWidth ?? 800)),
        height: Math.max(1, Math.round(browserArea.current?.clientHeight ?? 600)),
        visible: isVisible,
        ...patch,
      }),
    );
  const openPage = (page: BrowserPage) =>
    run(() => browser.command({ type: "open-page", sessionId, page }));
  const exportPage = (type: "screenshot" | "print") => {
    setBusy(true);
    run(async () => {
      try {
        await saveBrowserFile(await browser.command<BrowserFile>({ type, sessionId }), true);
      } finally {
        setBusy(false);
      }
    });
  };
  const find = (backwards = false) =>
    run(async () => {
      const result = await browser.command<{ found: boolean }>({
        type: "find",
        sessionId,
        text: query,
        backwards,
      });
      setFound(result.found);
    });
  const beginImport = (type: typeof importType.current) => {
    importType.current = type;
    if (fileInput.current) {
      fileInput.current.accept =
        type === "cookies.import" ? ".json,application/json" : ".csv,text/csv";
      fileInput.current.click();
    }
  };
  const browserContent = (
    <div ref={browserArea} className="relative h-full min-h-0 w-full overflow-hidden">
      <BrowserViewport
        browser={browser}
        sessionId={sessionId}
        isVisible={isVisible}
        zoom={zoom}
        device={device}
        onError={fail}
        onFind={() => setFinding(true)}
      />
      {isBlank ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background p-8 text-center text-sm text-muted-foreground">
          {t("extensions.workspaceBrowser.viewportDescription")}
        </div>
      ) : (
        <BrowserAnnotationLayer
          surface={surface}
          label={t("extensions.workspaceBrowser.annotate")}
        />
      )}
      {busy ? (
        <div
          role="status"
          className="absolute start-2 top-2 rounded-(--button-radius) bg-background p-2"
        >
          <LoaderCircleIcon className="size-(--icon-size-md) animate-spin" />
          <span className="sr-only">{t("extensions.workspaceBrowser.processing")}</span>
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col">
      <form
        className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          navigate();
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!session.canGoBack}
          aria-label={t("extensions.workspaceBrowser.back")}
          title={t("extensions.workspaceBrowser.back")}
          onClick={() => run(() => browser.goBack(sessionId))}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!session.canGoForward}
          aria-label={t("extensions.workspaceBrowser.forward")}
          title={t("extensions.workspaceBrowser.forward")}
          onClick={() => run(() => browser.goForward(sessionId))}
        >
          <ArrowRightIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t(
            loading ? "extensions.workspaceBrowser.stop" : "extensions.workspaceBrowser.reload",
          )}
          title={t(
            loading ? "extensions.workspaceBrowser.stop" : "extensions.workspaceBrowser.reload",
          )}
          onClick={() =>
            run(() =>
              loading ? browser.command({ type: "stop", sessionId }) : browser.reload(sessionId),
            )
          }
        >
          {loading ? <SquareIcon /> : <RefreshCwIcon />}
        </Button>
        <BrowserAddressBar
          browser={browser}
          value={address}
          url={session.url}
          showFullUrl={settings.showFullUrl}
          error={error}
          onNavigate={navigate}
          onChange={(value) => {
            setAddress(value);
            setError(false);
            try {
              drafts.setItem(draftKey, value);
            } catch {
              /* Best-effort draft. */
            }
          }}
        />
        <span role="status" aria-atomic="true" className="inline-flex shrink-0">
          {session.agentControlled ? <BrowserControlBadge /> : null}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("extensions.workspaceBrowser.settings.downloads")}
          title={t("extensions.workspaceBrowser.settings.downloads")}
          onClick={() => setDownloadsOpen(true)}
        >
          <DownloadIcon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button type="button" variant="ghost" size="icon-sm" />}
            aria-label={t("extensions.workspaceBrowser.menu")}
            title={t("extensions.workspaceBrowser.menu")}
          >
            <MoreVerticalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
            <DropdownMenuItem onClick={() => setFinding(true)}>
              <SearchIcon />
              {t("extensions.workspaceBrowser.find")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onClick={() => exportPage("print")}>
              <PrinterIcon />
              {t("extensions.workspaceBrowser.print")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-1 px-1.5 py-1">
              <span className="flex-1 text-sm">{t("extensions.workspaceBrowser.zoom")}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={zoom <= 0.25}
                aria-label={t("extensions.workspaceBrowser.zoomOut")}
                onClick={() => viewport({ zoom: Math.max(0.25, zoom - 0.1) })}
              >
                <MinusIcon />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title={t("extensions.workspaceBrowser.zoomReset")}
                onClick={() => viewport({ zoom: 1 })}
              >
                {zoomLabel}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={zoom >= 3}
                aria-label={t("extensions.workspaceBrowser.zoomIn")}
                onClick={() => viewport({ zoom: Math.min(3, zoom + 0.1) })}
              >
                <PlusIcon />
              </Button>
            </div>
            <DropdownMenuCheckboxItem
              checked={Boolean(device)}
              onCheckedChange={(checked) => {
                setPreviewScale("fit");
                setDevice(
                  checked
                    ? {
                        width: Math.max(
                          240,
                          Math.min(3840, browserArea.current?.clientWidth ?? 390),
                        ),
                        height: Math.max(
                          240,
                          Math.min(3840, browserArea.current?.clientHeight ?? 844),
                        ),
                        mobile: false,
                      }
                    : undefined,
                );
              }}
            >
              <SmartphoneIcon />
              {t("extensions.workspaceBrowser.deviceToolbar")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem disabled={busy} onClick={() => exportPage("screenshot")}>
              <CameraIcon />
              {t("extensions.workspaceBrowser.screenshot")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => beginImport("cookies.import")}>
              <UploadIcon />
              {t("extensions.workspaceBrowser.importCookies")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => beginImport("passwords.import")}>
              <UploadIcon />
              {t("extensions.workspaceBrowser.importPasswords")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openPage("passwords")}>
              <KeyRoundIcon />
              {t("extensions.workspaceBrowser.settings.autofill")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDownloadsOpen(true)}>
              <DownloadIcon />
              {t("extensions.workspaceBrowser.settings.downloads")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openPage("history")}>
              <HistoryIcon />
              {t("extensions.workspaceBrowser.settings.history")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openPage("clear-data")}>
              <Trash2Icon />
              {t("extensions.workspaceBrowser.settings.clearData")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => mainViews.open(createSettingsMainViewRequest("browser"))}
            >
              <SettingsIcon />
              {t("extensions.workspaceBrowser.browserSettings")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </form>
      {finding ? (
        <form
          className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            find();
          }}
        >
          <Input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setFound(undefined);
            }}
            aria-label={t("extensions.workspaceBrowser.find")}
            placeholder={t("extensions.workspaceBrowser.find")}
            className="min-w-0 flex-1 text-xs"
            onKeyDown={(event) => {
              if (event.key === "Escape") setFinding(false);
            }}
          />
          {found === false ? (
            <span role="status" className="text-muted-foreground text-xs">
              {t("extensions.workspaceBrowser.notFound")}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("extensions.workspaceBrowser.findPrevious")}
            onClick={() => find(true)}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            type="submit"
            variant="ghost"
            size="icon-sm"
            aria-label={t("extensions.workspaceBrowser.findNext")}
          >
            <ChevronDownIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("extensions.workspaceBrowser.settings.close")}
            onClick={() => setFinding(false)}
          >
            <XIcon />
          </Button>
        </form>
      ) : null}
      {device ? (
        <BrowserDeviceToolbar
          device={device}
          previewScale={previewScale}
          onDeviceChange={setDevice}
          onPreviewScaleChange={setPreviewScale}
          onClose={() => setDevice(undefined)}
          locale={locale}
          labels={{
            dimensions: t("extensions.workspaceBrowser.deviceDimensions"),
            responsive: t("extensions.workspaceBrowser.deviceResponsive"),
            phone: t("extensions.workspaceBrowser.devicePhone"),
            tablet: t("extensions.workspaceBrowser.deviceTablet"),
            desktop: t("extensions.workspaceBrowser.deviceDesktop"),
            width: t("extensions.workspaceBrowser.deviceWidth"),
            height: t("extensions.workspaceBrowser.deviceHeight"),
            rotate: t("extensions.workspaceBrowser.deviceRotate"),
            previewScale: t("extensions.workspaceBrowser.devicePreviewScale"),
            fit: t("extensions.workspaceBrowser.deviceFit"),
            close: t("extensions.workspaceBrowser.deviceClose"),
          }}
        />
      ) : null}
      {error || session.status === "error" || session.status === "disconnected" ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-destructive"
        >
          <span className="flex-1">
            {t(
              session.status === "disconnected"
                ? "rightWorkspace.status.disconnected"
                : "extensions.workspaceBrowser.settings.actionError",
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={() => run(() => browser.reload(sessionId))}>
            {t("extensions.workspaceBrowser.settings.retry")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("extensions.workspaceBrowser.settings.close")}
            onClick={() => setError(false)}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {device ? (
          <BrowserDevicePreview
            device={device}
            previewScale={previewScale}
            onDeviceChange={setDevice}
            labels={{
              preview: t("extensions.workspaceBrowser.devicePreview"),
              resizeWidth: t("extensions.workspaceBrowser.deviceResizeWidth"),
              resizeHeight: t("extensions.workspaceBrowser.deviceResizeHeight"),
            }}
          >
            {browserContent}
          </BrowserDevicePreview>
        ) : (
          browserContent
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        aria-label={t("extensions.workspaceBrowser.settings.import")}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          run(async () => {
            if (file.size > 8 * 1024 * 1024) throw new Error("Browser import exceeds 8 MB.");
            await browser.command({ type: importType.current, data: await file.text() });
          });
        }}
      />
      <BrowserDownloadsDialog open={downloadsOpen} onOpenChange={setDownloadsOpen} />
    </section>
  );
}
