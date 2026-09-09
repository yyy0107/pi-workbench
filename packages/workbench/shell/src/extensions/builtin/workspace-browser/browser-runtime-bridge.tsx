"use client";

import { useCallback } from "react";

import { useRightWorkspace, useWorkspaceContext } from "../../../right-workspace-react";
import { toolStringArg, useCompletedToolCalls } from "@workbench/agent-runtime-client";
import { useExtensionErrorReporter } from "@workbench/extension-host";
import { BROWSER_TOOL_ACTIONS } from "@workbench/browser-contracts";

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
        const ownTool =
          part.toolName === "workbench_browser" ||
          Object.hasOwn(BROWSER_TOOL_ACTIONS, part.toolName);
        const result =
          part.result && typeof part.result === "object" && !Array.isArray(part.result)
            ? part.result
            : undefined;
        const details = ownTool && result && "details" in result ? result.details : undefined;
        const sessionId =
          toolStringArg(details, "browserSessionId") ??
          toolStringArg(part.arguments, "browserSessionId", "sessionId", "session_id");
        if (
          !/browser/i.test(part.toolName) ||
          part.status !== "complete" ||
          part.result === undefined
        ) {
          return false;
        }
        // Thread revisits replay completed calls; preserve the live page and its address history.
        const callKey = JSON.stringify([context.threadId ?? context.applicationId, part.callId]);
        if (handledCalls.has(callKey)) return true;
        if (
          ownTool &&
          (part.toolName === "browser_close_tab" ||
            toolStringArg(part.arguments, "action") === "close") &&
          sessionId
        ) {
          handledCalls.add(callKey);
          for (const surface of Object.values(store.getState().surfaces)) {
            if (surface.kind === "browser" && surface.params.browserSessionId === sessionId) {
              controller.close(surface.id);
            }
          }
          return true;
        }
        const entries =
          ownTool &&
          details &&
          typeof details === "object" &&
          "browserSessions" in details &&
          Array.isArray(details.browserSessions)
            ? details.browserSessions
            : [ownTool ? details : part.arguments];
        const sessions = entries.flatMap((entry) => {
          const url = toolStringArg(entry, "url");
          const id =
            toolStringArg(entry, "browserSessionId", "sessionId", "session_id") ?? sessionId;
          return url && id ? [{ id, url, projectId: toolStringArg(entry, "projectId") }] : [];
        });
        if (!sessions.length) return false;
        handledCalls.add(callKey);
        const reveal = async () => {
          for (const { id: sessionId, url, projectId } of sessions) {
            if (browserSessionService.getSession(sessionId)) {
              if (!ownTool)
                await browserSessionService.command(
                  { type: "navigate", sessionId, threadId: context.threadId, url },
                  "agent",
                );
            } else {
              browserSessionService.attach({
                id: sessionId,
                projectId: projectId ?? context.projectId ?? context.applicationId,
                threadId: context.threadId,
                url,
                title: url,
                status: "ready",
                canGoBack: false,
                canGoForward: false,
              });
            }
            const session = browserSessionService.getSession(sessionId);
            if (!session) continue;
            controller.reveal({
              kind: "browser",
              title: session.title,
              params: { browserSessionId: session.id, url: session.url },
              context,
              status: "ready",
              policy: "background",
            });
          }
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
