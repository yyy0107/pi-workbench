"use client";

import { useEffect } from "react";
import { useRuntimeConnection } from "../../../runtime-connection";
import {
  useRightWorkspaceInstallationResource,
  useRightWorkspaceEnvironment,
} from "../../../right-workspace/right-workspace-context";
import type { BrowserSessionService } from "./memory-browser-session-service";
import { RemoteBrowserSessionService } from "./remote-browser-session-service";

export * from "./memory-browser-session-service";
export const BROWSER_SESSION_SERVICE_RESOURCE = Symbol("workbench.browser-session-service");
const BROWSER_SURFACE_LIFECYCLE_RESOURCE = Symbol("workbench.browser-surface-lifecycle");

export function useBrowserSessionService(): BrowserSessionService {
  const connection = useRuntimeConnection();
  const { store } = useRightWorkspaceEnvironment();
  const browser = useRightWorkspaceInstallationResource<BrowserSessionService>(
    BROWSER_SESSION_SERVICE_RESOURCE,
    () => new RemoteBrowserSessionService(connection),
  );
  const lifecycle = useRightWorkspaceInstallationResource(
    BROWSER_SURFACE_LIFECYCLE_RESOURCE,
    () => {
      let unsubscribe: (() => void) | undefined;
      const sessionIds = () =>
        new Set(
          Object.values(store.getState().surfaces).flatMap((surface) =>
            surface.kind === "browser" && typeof surface.params.browserSessionId === "string"
              ? [surface.params.browserSessionId]
              : [],
          ),
        );
      return {
        start() {
          if (unsubscribe) return;
          let previous = sessionIds();
          unsubscribe = store.subscribe(() => {
            const current = sessionIds();
            for (const sessionId of previous) {
              if (!current.has(sessionId))
                void browser.command({ type: "close", sessionId }).catch(() => {});
            }
            previous = current;
          });
        },
        dispose() {
          unsubscribe?.();
          unsubscribe = undefined;
        },
      };
    },
  );
  useEffect(() => lifecycle.start(), [lifecycle]);
  return browser;
}
