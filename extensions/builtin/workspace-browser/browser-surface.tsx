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
const BROWSER_ADDRESS_DRAFT_PREFIX = "pi-workbench:browser-address-draft:v1";

function browserAddressDraftKey(sessionId: string): string {
  return `${BROWSER_ADDRESS_DRAFT_PREFIX}:${sessionId}`;
}

function readBrowserAddressDraft(sessionId: string): string | undefined {
  try {
    return window.sessionStorage.getItem(browserAddressDraftKey(sessionId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeBrowserAddressDraft(sessionId: string, address: string | undefined): void {
  try {
    const key = browserAddressDraftKey(sessionId);
    if (address) window.sessionStorage.setItem(key, address);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Draft persistence is best effort; the in-memory address remains usable.
  }
}

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
    setAddress(
      readBrowserAddressDraft(surface.params.browserSessionId) ?? session?.url ?? "about:blank",
    );
  }, [session?.url, surface.params.browserSessionId]);

  const navigate = () => {
    if (!session) return;
    controller.update(surface.id, { status: "loading" });
    void browser
      .navigate(session.id, address)
      .then(() => {
        writeBrowserAddressDraft(session.id, undefined);
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
          className="inline-flex size-[var(--icon-frame-size-default)] items-center justify-center rounded-[var(--button-radius)] hover:[background:var(--icon-frame-background-hover)] disabled:opacity-35"
          onClick={() => void browser.goBack(session.id)}
        >
          <ArrowLeftIcon className="size-[var(--icon-size-sm)]" />
        </button>
        <button
          type="button"
          disabled={!session.canGoForward}
          aria-label={t("extensions.workspaceBrowser.forward")}
          title={t("extensions.workspaceBrowser.forward")}
          className="inline-flex size-[var(--icon-frame-size-default)] items-center justify-center rounded-[var(--button-radius)] hover:[background:var(--icon-frame-background-hover)] disabled:opacity-35"
          onClick={() => void browser.goForward(session.id)}
        >
          <ArrowRightIcon className="size-[var(--icon-size-sm)]" />
        </button>
        <button
          type="button"
          aria-label={t("extensions.workspaceBrowser.reload")}
          title={t("extensions.workspaceBrowser.reload")}
          className="inline-flex size-[var(--icon-frame-size-default)] items-center justify-center rounded-[var(--button-radius)] hover:[background:var(--icon-frame-background-hover)]"
          onClick={() => void browser.reload(session.id)}
        >
          <RefreshCwIcon className="size-[var(--icon-size-sm)]" />
        </button>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t("extensions.workspaceBrowser.address")}</span>
          <Globe2Icon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-[var(--input-control-icon-size)] -translate-y-1/2" />
          <input
            value={address}
            className="h-[var(--input-control-height)] w-full rounded-[var(--input-control-radius)] border border-transparent [background:var(--input-control-background)] pr-2 pl-8 text-xs outline-none focus:[border-color:var(--input-control-border-focus)]"
            onChange={(event) => {
              const nextAddress = event.currentTarget.value;
              setAddress(nextAddress);
              writeBrowserAddressDraft(surface.params.browserSessionId, nextAddress);
            }}
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
