"use client";

import { ArrowLeftIcon, ArrowRightIcon, Globe2Icon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { defineMessage, useI18n } from "../../../i18n";
import { useExtensionErrorReporter } from "@workbench/extension-host";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";

import { useRightWorkspace, useWorkspaceDraftStore } from "../../../right-workspace-react";
import type { WorkspaceDraftStore } from "../../../right-workspace";
import { Button } from "../../../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../../ui/input-group";
import { useBrowserSessionService } from "./browser-session-service";
import { BrowserAnnotationLayer } from "./browser-annotation-layer";

export interface BrowserSurfaceParams extends Record<string, unknown> {
  browserSessionId: string;
  url?: string;
}

const BROWSER_NAVIGATE_FAILED = defineMessage("extensions.workspaceBrowser.navigateFailed");
const BROWSER_ADDRESS_DRAFT_PREFIX = "workbench:browser-address-draft:v2";

function browserAddressDraftKey(prefix: string, sessionId: string): string {
  return `${prefix}:${sessionId}`;
}

function readBrowserAddressDraft(
  drafts: WorkspaceDraftStore,
  sessionId: string,
): string | undefined {
  try {
    const key = browserAddressDraftKey(BROWSER_ADDRESS_DRAFT_PREFIX, sessionId);
    return drafts.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeBrowserAddressDraft(
  drafts: WorkspaceDraftStore,
  sessionId: string,
  address: string | undefined,
): void {
  try {
    const key = browserAddressDraftKey(BROWSER_ADDRESS_DRAFT_PREFIX, sessionId);
    if (address) drafts.setItem(key, address);
    else drafts.removeItem(key);
  } catch {
    // Draft persistence is best effort; the in-memory address remains usable.
  }
}

export function BrowserSurface({
  surface,
  retryToken = 0,
}: WorkspaceSurfaceProps<BrowserSurfaceParams>) {
  const { t } = useI18n();
  const browser = useBrowserSessionService();
  const drafts = useWorkspaceDraftStore();
  const controller = useRightWorkspace();
  const reportError = useExtensionErrorReporter();
  useSyncExternalStore(browser.subscribe.bind(browser), browser.getRevision.bind(browser), () => 0);
  const session = browser.getSession(surface.params.browserSessionId);
  const [address, setAddress] = useState(session?.url ?? surface.params.url ?? "about:blank");

  useEffect(() => {
    setAddress(
      readBrowserAddressDraft(drafts, surface.params.browserSessionId) ??
        session?.url ??
        "about:blank",
    );
  }, [drafts, session?.url, surface.params.browserSessionId]);

  const navigate = () => {
    if (!session) return;
    controller.update(surface.id, { status: "loading" });
    void browser
      .navigate(session.id, address)
      .then(() => {
        writeBrowserAddressDraft(drafts, session.id, undefined);
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
        className="flex min-h-11 shrink-0 items-center gap-1.5 border-b px-2"
        onSubmit={(event) => {
          event.preventDefault();
          navigate();
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!session.canGoBack}
          aria-label={t("extensions.workspaceBrowser.back")}
          title={t("extensions.workspaceBrowser.back")}
          onClick={() => void browser.goBack(session.id)}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!session.canGoForward}
          aria-label={t("extensions.workspaceBrowser.forward")}
          title={t("extensions.workspaceBrowser.forward")}
          onClick={() => void browser.goForward(session.id)}
        >
          <ArrowRightIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("extensions.workspaceBrowser.reload")}
          title={t("extensions.workspaceBrowser.reload")}
          onClick={() => void browser.reload(session.id)}
        >
          <RefreshCwIcon />
        </Button>
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("extensions.workspaceBrowser.address")}</span>
          <InputGroup>
            <InputGroupAddon>
              <Globe2Icon />
            </InputGroupAddon>
            <InputGroupInput
              value={address}
              className="text-xs"
              onChange={(event) => {
                const nextAddress = event.currentTarget.value;
                setAddress(nextAddress);
                writeBrowserAddressDraft(drafts, surface.params.browserSessionId, nextAddress);
              }}
            />
          </InputGroup>
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
