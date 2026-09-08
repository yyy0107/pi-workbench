"use client";

import { InlineFeedbackForm } from "../../../right-workspace/presentation";
import type { WorkspaceSurfaceInstance } from "@workbench/extension-sdk";
import type { BrowserFile } from "@workbench/browser-contracts";
import { useState, useSyncExternalStore } from "react";
import { useI18n } from "../../../i18n";
import { Switch } from "../../../ui/switch";
import { useBrowserSessionService } from "./browser-session-service";

import type { BrowserSurfaceParams } from "./browser-surface";

export function BrowserAnnotationLayer({
  surface,
  label,
}: Readonly<{ surface: WorkspaceSurfaceInstance<BrowserSurfaceParams>; label: string }>) {
  const { t } = useI18n();
  const browser = useBrowserSessionService();
  useSyncExternalStore(
    (listener) => browser.subscribe(listener),
    () => browser.getRevision(),
    () => browser.getRevision(),
  );
  const [includeScreenshot, setIncludeScreenshot] = useState(false);
  const policy = browser.getSettings().annotationScreenshots;
  const sessionId = surface.params.browserSessionId;
  const target = {
    sessionId,
    url: browser.getSession(sessionId)?.url ?? surface.params.url ?? "about:blank",
    selector: "document",
  };
  return (
    <div className="absolute end-3 bottom-3">
      <InlineFeedbackForm
        surface={surface}
        kind="browser-element"
        label={label}
        target={target}
        prepareError={t("extensions.workspaceBrowser.annotationScreenshotFailed")}
        prepare={async () => {
          if (policy === "never" || (policy === "ask" && !includeScreenshot)) return {};
          const file = await browser.command<BrowserFile>({ type: "screenshot", sessionId });
          if (browser.getSession(sessionId)?.url !== target.url) throw new Error("Page changed.");
          const name = `browser-annotation-${crypto.randomUUID()}.png`;
          setIncludeScreenshot(false);
          return {
            target: { ...target, screenshot: { name, capturedAt: Date.now() } },
            images: [{ ...file, name }],
          };
        }}
      >
        {policy === "ask" ? (
          <label className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            {t("extensions.workspaceBrowser.includeScreenshot")}
            <Switch
              size="compact"
              checked={includeScreenshot}
              onCheckedChange={setIncludeScreenshot}
              aria-label={t("extensions.workspaceBrowser.includeScreenshot")}
            />
          </label>
        ) : null}
      </InlineFeedbackForm>
    </div>
  );
}
