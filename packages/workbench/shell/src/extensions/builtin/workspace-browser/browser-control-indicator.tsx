"use client";

import { MousePointer2Icon } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";

import { useI18n } from "../../../i18n";
import { StatusBadge } from "../../../ui/status-badge";
import { useBrowserSessionService } from "./browser-session-service";
import type { BrowserSurfaceParams } from "./browser-surface";

export function BrowserControlBadge() {
  const { t } = useI18n();
  const label = t("extensions.workspaceBrowser.agentControlled");
  return (
    <StatusBadge tone="info" className="shrink-0" role="img" title={label} aria-label={label}>
      <MousePointer2Icon aria-hidden="true" className="size-(--icon-size-sm)" />
    </StatusBadge>
  );
}

export function BrowserTabIndicator({ surface }: WorkspaceSurfaceProps<BrowserSurfaceParams>) {
  const browser = useBrowserSessionService();
  const controlled = useSyncExternalStore(
    (listener) => browser.subscribe(listener),
    () => browser.getSession(surface.params.browserSessionId)?.agentControlled === true,
    () => false,
  );
  return controlled ? <BrowserControlBadge /> : null;
}
