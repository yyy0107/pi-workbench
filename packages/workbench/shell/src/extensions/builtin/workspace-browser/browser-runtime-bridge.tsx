"use client";

import { useCallback } from "react";

import { useRightWorkspace, useWorkspaceContext } from "../../../right-workspace-react";
import { toolStringArg, useCompletedToolCalls } from "@workbench/agent-runtime-client";

import { useBrowserSessionService } from "./browser-session-service";

export function BrowserRuntimeBridge() {
  const browserSessionService = useBrowserSessionService();
  const controller = useRightWorkspace();
  const context = useWorkspaceContext();

  useCompletedToolCalls(
    useCallback(
      (part) => {
        const url = toolStringArg(part.args, "url");
        const sessionId = toolStringArg(part.args, "browserSessionId", "sessionId", "session_id");
        if (!/browser/i.test(part.toolName) || part.result === undefined || !url || !sessionId) {
          return false;
        }
        const projectId = context.projectId ?? context.applicationId;
        if (!browserSessionService.getSession(sessionId)) {
          browserSessionService.attach({
            id: sessionId,
            projectId,
            url,
            title: url,
            status: "ready",
            canGoBack: false,
            canGoForward: false,
          });
        }
        controller.reveal({
          kind: "browser",
          title: url,
          params: { browserSessionId: sessionId, url },
          context,
          scope: context.threadId
            ? { type: "thread", key: context.threadId }
            : { type: "application", key: context.applicationId },
          status: "ready",
          policy: "background",
        });
        return true;
      },
      [context, controller],
    ),
  );

  return null;
}
