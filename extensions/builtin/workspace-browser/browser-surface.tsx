"use client";

import { ArrowLeftIcon, ArrowRightIcon, Globe2Icon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { defineMessage, useI18n } from "@/i18n";
import { useExtensionErrorReporter, type WorkspaceSurfaceProps } from "@/platform/extensions";

import { useRightWorkspace } from "@/components/right-workspace";
import { browserSessionService as browser } from "./browser-session-service";
import { BrowserAnnotationLayer } from "./browser-annotation-layer";

export interface BrowserSurfaceParams extends Record<string, unknown> {
  browserSessionId: string;
  url?: string;
}

const BROWSER_NAVIGATE_FAILED = defineMessage("extensions.workspaceBrowser.navigateFailed");

export function BrowserSurface({
  surface,
  retryToken = 0,
}: WorkspaceSurfaceProps<BrowserSurfaceParams>) {
  const { t } = useI18n();
  const controller = useRightWorkspace();
  const reportError = useExtensionErrorReporter();
  useSyncExternalStore(browser.subscribe.bind(browser), browser.getRevision.bind(browser), () => 0);
  const session = browser.getSession(surface.params.browserSessionId);
  const [address, setAddress] = useState(session?.url ?? surface.params.url ?? "about:blank");

  useEffect(() => {
    if (session?.url) setAddress(session.url);
  }, [session?.url]);

  const navigate = () => {
    if (!session) return;
    controller.update(surface.id, { status: "loading" });
    void browser
      .navigate(session.id, address)
      .then(() => {
        const nextTitle = browser.getSession(session.id)?.title;
        controller.update(surface.id, {
          status: "ready",
          ...(nextTitle ? { title: nextTitle } : {}),
          params: { ...surface.params, url: browser.getSession(session.id)?.url },
        });
      })
      .catch((error: unknown) => {
        reportError(error, { source: "workspace", contributionId: surface.id });
        controller.update(surface.id, {
          status: "error",
          statusMessage: BROWSER_NAVIGATE_FAILED,
        });
      });
  };
  const retryNavigate = useRef(navigate);
  retryNavigate.current = navigate;

  useEffect(() => {
    if (retryToken === 0) return;
    retryNavigate.current();
  }, [retryToken]);

  if (!session) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-center text-sm">
        {t("rightWorkspace.status.disconnected")}
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <form
        className="flex h-11 shrink-0 items-center gap-1.5 border-b px-2"
        onSubmit={(event) => {
          event.preventDefault();
          navigate();
        }}
      >
        <button
          type="button"
          disabled={!session.canGoBack}
          aria-label={t("extensions.workspaceBrowser.back")}
          title={t("extensions.workspaceBrowser.back")}
          className="hover:bg-muted inline-flex size-7 items-center justify-center rounded-md disabled:opacity-35"
          onClick={() => void browser.goBack(session.id)}
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={!session.canGoForward}
          aria-label={t("extensions.workspaceBrowser.forward")}
          title={t("extensions.workspaceBrowser.forward")}
          className="hover:bg-muted inline-flex size-7 items-center justify-center rounded-md disabled:opacity-35"
          onClick={() => void browser.goForward(session.id)}
        >
          <ArrowRightIcon className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={t("extensions.workspaceBrowser.reload")}
          title={t("extensions.workspaceBrowser.reload")}
          className="hover:bg-muted inline-flex size-7 items-center justify-center rounded-md"
          onClick={() => void browser.reload(session.id)}
        >
          <RefreshCwIcon className="size-3.5" />
        </button>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t("extensions.workspaceBrowser.address")}</span>
          <Globe2Icon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <input
            value={address}
            className="bg-muted/45 h-8 w-full rounded-lg border border-transparent pr-2 pl-8 text-xs outline-none focus:border-ring"
            onChange={(event) => setAddress(event.currentTarget.value)}
          />
        </label>
      </form>
      <div className="relative min-h-0 flex-1 overflow-hidden p-3">
        <div className="bg-muted/25 flex size-full flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
          <Globe2Icon className="text-muted-foreground mb-3 size-8" />
          <p className="text-sm font-medium">{t("extensions.workspaceBrowser.viewportTitle")}</p>
          <p className="text-muted-foreground mt-1 max-w-sm text-xs leading-5">
            {t("extensions.workspaceBrowser.viewportDescription")}
          </p>
          <p className="text-muted-foreground mt-4 max-w-full truncate font-mono text-[11px]">
            {session.url}
          </p>
        </div>
        <BrowserAnnotationLayer
          surface={surface}
          label={t("extensions.workspaceBrowser.annotate")}
        />
      </div>
    </section>
  );
}
