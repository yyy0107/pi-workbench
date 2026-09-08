"use client";

import { useCallback } from "react";

import { useRightWorkspace, useWorkspaceContext } from "../../../right-workspace-react";
import { toolStringArg, useCompletedToolCalls } from "@workbench/agent-runtime-client";
import { useExtensionErrorReporter } from "@workbench/extension-host";

import { useBrowserSessionService } from "./browser-session-service";
import {
  useRightWorkspaceEnvironment,
  useRightWorkspaceInstallationResource,
} from "../../../right-workspace/right-workspace-context";

const BROWSER_HANDLED_CALLS = Symbol("workbench.browser-handled-calls");

export function BrowserRuntimeBridge() {
  const browserSessionService = useBrowserSessionService();
  const controller = useRightWorkspace();
  const { store } = useRightWorkspaceEnvironment();
  const context = useWorkspaceContext();
  const reportError = useExtensionErrorReporter();
  const handledCalls = useRightWorkspaceInstallationResource(
    BROWSER_HANDLED_CALLS,
    () => new Set<string>(),
  );

  useCompletedToolCalls(
    useCallback(
      (part) => {
        const ownTool = part.toolName === "workbench_browser";
        const result =
          part.result && typeof part.result === "object" && !Array.isArray(part.result)
            ? part.result
            : undefined;
        const details = ownTool && result && "details" in result ? result.details : undefined;
        const url = ownTool ? toolStringArg(details, "url") : toolStringArg(part.arguments, "url");
        const sessionId =
          toolStringArg(details, "browserSessionId") ??
          toolStringArg(part.arguments, "browserSessionId", "sessionId", "session_id");
        if (
          !/browser/i.test(part.toolName) ||
          part.status !== "complete" ||
          part.result === undefined ||
          !sessionId
        ) {
          return false;
        }
        // Thread revisits replay completed calls; preserve the live page and its address history.
        const callKey = JSON.stringify([context.threadId ?? context.applicationId, part.callId]);
        if (handledCalls.has(callKey)) return true;
        if (ownTool && toolStringArg(part.arguments, "action") === "close") {
          handledCalls.add(callKey);
          for (const surface of Object.values(store.getState().surfaces)) {
            if (surface.kind === "browser" && surface.params.browserSessionId === sessionId) {
              controller.close(surface.id);
            }
          }
          return true;
        }
        if (!url) return false;
        handledCalls.add(callKey);
        const reveal = async () => {
          if (browserSessionService.getSession(sessionId)) {
            if (!ownTool)
              await browserSessionService.command({ type: "navigate", sessionId, url }, "agent");
          } else {
            browserSessionService.attach({
              id: sessionId,
              projectId:
                toolStringArg(details, "projectId") ?? context.projectId ?? context.applicationId,
              url,
              title: url,
              status: "ready",
              canGoBack: false,
              canGoForward: false,
            });
          }
          const session = browserSessionService.getSession(sessionId);
          if (!session) return;
          controller.reveal({
            kind: "browser",
            title: session.title,
            params: { browserSessionId: session.id, url: session.url },
            context,
            status: "ready",
            policy: "background",
          });
        };
        void reveal().catch((error: unknown) => {
          reportError(error, { source: "workspace", contributionId: "browser" });
        });
        return true;
      },
      [browserSessionService, context, controller, handledCalls, reportError, store],
    ),
  );

  return null;
}
